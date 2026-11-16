use base64::Engine;
use reqwest::blocking::{Client, Response};
use reqwest::header::{ACCEPT, CACHE_CONTROL, CONTENT_TYPE, COOKIE, LOCATION};
use reqwest::{redirect, StatusCode};
use serde::Deserialize;
use std::io::Read;
use std::net::IpAddr;
use std::time::{Duration, SystemTime};
use tauri::webview::Cookie;
use tauri::{Url, Webview};

pub(super) const DEFAULT_COOKIE: &str = "sso_token";
const LOGIN_PATH: &str = "/sso/login";
const MAX_AVATAR_BYTES: usize = 256 * 1024;

#[derive(Clone)]
pub(super) struct Site(Url);

impl Site {
    pub(super) fn parse(raw: &str) -> Result<Self, String> {
        let mut url = Url::parse(raw.trim()).map_err(|err| format!("地址无效：{err}"))?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("请输入无凭据、查询参数和片段的 HTTP 或 HTTPS 站点地址".into());
        }
        if !url.path().ends_with('/') {
            url.set_path(&format!("{}/", url.path()));
        }
        Ok(Self(url))
    }

    pub(super) fn base(&self) -> &str {
        self.0.as_str().trim_end_matches('/')
    }

    pub(super) fn url(&self, path: &str) -> Url {
        self.0.join(path).expect("固定的相对 API 路径")
    }

    pub(super) fn from_login_url(url: &Url) -> Result<Self, String> {
        let path = url
            .path()
            .strip_suffix(LOGIN_PATH)
            .ok_or("远程实例返回的 HostID 登录地址无效")?;
        let mut base = url.clone();
        base.set_path(path);
        base.set_query(None);
        base.set_fragment(None);
        Self::parse(base.as_str())
    }
}

pub(super) struct Provider {
    pub(super) site: Site,
    pub(super) cookie_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct User {
    pub(super) id: String,
    pub(super) username: String,
    pub(super) nickname: Option<String>,
    pub(super) email: Option<String>,
    pub(super) avatar_url: Option<String>,
    #[serde(default)]
    pub(super) avatar: Option<String>,
}

impl User {
    fn validate(self) -> Result<Self, String> {
        if self.id.trim().is_empty() || self.username.trim().is_empty() {
            return Err("会话响应缺少用户 ID 或用户名".into());
        }
        Ok(self)
    }
}

#[derive(Deserialize)]
struct Session {
    authenticated: bool,
    user: Option<User>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Metadata {
    enabled: bool,
    server_url: Option<String>,
    cookie_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Unauthorized {
    error: String,
    login_url: String,
}

pub(super) enum RemoteAuth {
    HostId(Provider),
    Available,
}

pub(super) struct SessionClient {
    http: Client,
    local_http: Client,
    webview: Webview,
}

impl SessionClient {
    pub(super) fn new(webview: Webview) -> Result<Self, String> {
        let http = build_http_client(false)?;
        let local_http = build_http_client(true)?;
        Ok(Self {
            http,
            local_http,
            webview,
        })
    }

    pub(super) fn remote_auth(
        &self,
        site: &Site,
        remembered: Option<&Provider>,
    ) -> Result<RemoteAuth, String> {
        let loopback = is_loopback_url(&site.0);
        let response = self.get(site.url("api/auth/sso"), None)?;
        let status = response.status();
        let body = read_body_bytes(response)?;
        if let Some(result) = classify_sso_probe(status, &body, loopback, remembered)? {
            return Ok(result);
        }

        // 获取登录地址时有意省略 Cookie。已登录或关闭 SSO 的旧版/本地开发实例走直接探测。
        let response = self.get(site.url("api/auth/me"), None)?;
        let status = response.status();
        let body = read_body_bytes(response)?;
        classify_legacy_me_probe(status, &body, loopback, remembered)
    }

    pub(super) fn hostid_cookies(
        &self,
        provider: &Provider,
    ) -> Result<Vec<Cookie<'static>>, String> {
        self.hostid_cookies_on(&self.webview, provider)
    }

    pub(super) fn hostid_cookies_on(
        &self,
        webview: &Webview,
        provider: &Provider,
    ) -> Result<Vec<Cookie<'static>>, String> {
        self.cookies_on(
            webview,
            &provider.site.url("api/sso/session"),
            &provider.cookie_name,
        )
    }

    pub(super) fn session(
        &self,
        provider: &Provider,
        cookie: &Cookie<'_>,
    ) -> Result<Option<User>, String> {
        let mut user = fetch_session(self.http_for(&provider.site.0), provider, cookie)?;
        if let Some(ref mut profile) = user {
            let resolved = resolve_avatar_url(
                &provider.site,
                profile.avatar_url.as_deref(),
                profile.avatar.as_deref(),
            );
            profile.avatar_url = resolved.map(|url| {
                Url::parse(&url)
                    .ok()
                    .and_then(|parsed| {
                        fetch_avatar_data_url(
                            |target| self.http_for(target),
                            &provider.site,
                            &parsed,
                            cookie,
                        )
                    })
                    .unwrap_or(url)
            });
        }
        Ok(user)
    }

    pub(super) fn verify_remote(
        &self,
        site: &Site,
        provider: &Provider,
        user: &User,
    ) -> Result<(), String> {
        let url = site.url("api/auth/me");
        let cookies = self.cookies(&url, &provider.cookie_name)?;
        if cookies.is_empty() {
            return Err(
                "HostID 会话有效，但远程实例收不到共享 Cookie。请检查 HostID 的 Cookie 域和路径配置"
                    .into(),
            );
        }
        let http = self.http_for(&url);
        let stale_cookies = verify_remote_cookies(&cookies, user, |cookie| {
            fetch_remote_user(http, &url, cookie)
        })?;
        for stale in stale_cookies {
            let _ = self.delete_webview_cookie(stale);
        }
        Ok(())
    }

    pub(super) fn logout(&self, provider: &Provider) -> Result<(), String> {
        let url = provider.site.url("api/sso/logout");
        let cookies = self.cookies(&url, &provider.cookie_name)?;
        let http = self.http_for(&url);
        let mut result = Ok(());
        for cookie in cookies {
            let response = http
                .post(url.clone())
                .header(COOKIE, cookie_pair(&cookie))
                .send()
                .map_err(|err| format!("无法撤销 HostID 会话：{err}"))
                .and_then(|response| {
                    if response.status().is_success() {
                        Ok(())
                    } else {
                        Err(format!(
                            "无法撤销 HostID 会话（HTTP {}）",
                            response.status()
                        ))
                    }
                });
            let deleted = self.delete_webview_cookie(cookie);
            result = result.and(deleted).and(response);
        }
        result
    }

    pub(super) fn clear_cookies(&self, provider: &Provider) -> Result<(), String> {
        let cookies = self.cookies(&provider.site.url("api/sso/session"), &provider.cookie_name)?;
        for cookie in cookies {
            self.delete_webview_cookie(cookie)?;
        }
        Ok(())
    }

    fn delete_webview_cookie(&self, cookie: Cookie<'static>) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            super::wk_cookie::delete_cookie(&self.webview, &cookie)
        }
        #[cfg(not(target_os = "macos"))]
        {
            self.webview
                .delete_cookie(cookie)
                .map_err(|err| format!("无法清除本地 HostID Cookie：{err}"))
        }
    }

    fn cookies(&self, url: &Url, name: &str) -> Result<Vec<Cookie<'static>>, String> {
        self.cookies_on(&self.webview, url, name)
    }

    fn cookies_on(
        &self,
        webview: &Webview,
        url: &Url,
        name: &str,
    ) -> Result<Vec<Cookie<'static>>, String> {
        // WKWebView 的 cookies_for_url 只匹配完全相同的域，会漏掉 .example.com 共享 Cookie。
        // 且 macOS 上 wry::cookies() 会在主事件循环持锁期间同步泵 NSRunLoop，易触发重绘自死锁。
        #[cfg(target_os = "macos")]
        let cookies = super::wk_cookie::read_cookies(webview)?
            .into_iter()
            .filter(|cookie| matches_wk_cookie(cookie, url))
            .collect::<Vec<_>>();
        #[cfg(not(target_os = "macos"))]
        let cookies = webview
            .cookies_for_url(url.clone())
            .map_err(|err| format!("读取 WebView Cookie 失败：{err}"))?;

        Ok(select_cookies(cookies, url, name, SystemTime::now()))
    }

    fn http_for(&self, url: &Url) -> &Client {
        if is_loopback_url(url) {
            &self.local_http
        } else {
            &self.http
        }
    }

    fn get(&self, url: Url, cookie: Option<&Cookie<'_>>) -> Result<Response, String> {
        get_with(self.http_for(&url), url, cookie)
    }
}

fn build_http_client(no_proxy: bool) -> Result<Client, String> {
    let mut builder = Client::builder()
        .redirect(redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12));
    if no_proxy {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .map_err(|err| format!("无法初始化会话客户端：{err}"))
}

fn classify_sso_probe(
    status: StatusCode,
    body: &[u8],
    loopback: bool,
    remembered: Option<&Provider>,
) -> Result<Option<RemoteAuth>, String> {
    match status {
        StatusCode::OK => match serde_json::from_slice::<Metadata>(body) {
            Ok(metadata) => parse_sso_metadata(metadata).map(Some),
            // 本地开发前端（如 Vite 5173）未接通后端或直接回落到 SPA HTML，视为未启用 SSO。
            Err(_) if loopback => Ok(Some(RemoteAuth::Available)),
            Err(_) => Err("远程实例 SSO 配置响应格式无效".into()),
        },
        StatusCode::UNAUTHORIZED => legacy_provider_bytes(body, remembered).map(Some),
        StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED => Ok(None),
        status if loopback && !status.is_success() => Ok(Some(RemoteAuth::Available)),
        status => Err(format!("无法获取远程实例 SSO 配置（HTTP {status}）")),
    }
}

fn parse_sso_metadata(metadata: Metadata) -> Result<RemoteAuth, String> {
    if !metadata.enabled {
        return Ok(RemoteAuth::Available);
    }
    let server = metadata.server_url.ok_or("远程实例缺少 HostID 地址")?;
    let cookie_name = metadata
        .cookie_name
        .filter(|name| !name.trim().is_empty())
        .ok_or("远程实例缺少 SSO Cookie 名称")?;
    Ok(RemoteAuth::HostId(Provider {
        site: Site::parse(&server)?,
        cookie_name,
    }))
}

fn classify_legacy_me_probe(
    status: StatusCode,
    body: &[u8],
    loopback: bool,
    remembered: Option<&Provider>,
) -> Result<RemoteAuth, String> {
    match status {
        StatusCode::OK => match serde_json::from_slice::<User>(body) {
            Ok(user) => {
                user.validate()?;
                Ok(RemoteAuth::Available)
            }
            Err(_) if loopback => Ok(RemoteAuth::Available),
            Err(_) => Err("远程实例用户响应格式无效".into()),
        },
        StatusCode::UNAUTHORIZED => legacy_provider_bytes(body, remembered),
        status if loopback && !status.is_success() => Ok(RemoteAuth::Available),
        status => Err(format!("远程实例无法校验会话（HTTP {status}）")),
    }
}

fn resolve_avatar_url(
    site: &Site,
    avatar_url: Option<&str>,
    avatar: Option<&str>,
) -> Option<String> {
    if let Some(raw) = avatar_url.map(str::trim).filter(|s| !s.is_empty()) {
        return normalize_avatar_ref(site, raw, false);
    }
    let raw = avatar.map(str::trim).filter(|s| !s.is_empty())?;
    normalize_avatar_ref(site, raw, true)
}

fn normalize_avatar_ref(site: &Site, raw: &str, bare_is_hostid_filename: bool) -> Option<String> {
    if is_safe_raster_data_url(raw) {
        return Some(raw.to_string());
    }
    if raw.starts_with("http://") || raw.starts_with("https://") {
        return Url::parse(raw).ok().map(|url| url.to_string());
    }
    if raw.starts_with('/') {
        return Some(site.url(raw.trim_start_matches('/')).to_string());
    }
    if bare_is_hostid_filename {
        return Some(site.url(&format!("api/auth/avatar/{raw}")).to_string());
    }
    Some(site.url(raw).to_string())
}

fn is_safe_raster_data_url(raw: &str) -> bool {
    let lower = raw.to_ascii_lowercase();
    [
        "data:image/png;",
        "data:image/jpeg;",
        "data:image/jpg;",
        "data:image/gif;",
        "data:image/webp;",
        "data:image/avif;",
    ]
    .iter()
    .any(|prefix| lower.starts_with(prefix))
}

fn fetch_avatar_data_url<'a>(
    client_for: impl Fn(&Url) -> &'a Client,
    site: &Site,
    initial: &Url,
    cookie: &Cookie<'_>,
) -> Option<String> {
    let mut current = initial.clone();
    for _ in 0..=3 {
        if !matches!(current.scheme(), "http" | "https") {
            return None;
        }
        let mut request = client_for(&current)
            .get(current.clone())
            .header(ACCEPT, "image/*")
            .header(CACHE_CONTROL, "no-cache")
            .timeout(Duration::from_secs(4));
        if should_send_avatar_cookie(site, &current) {
            request = request.header(COOKIE, cookie_pair(cookie));
        }
        let response = request.send().ok()?;
        let status = response.status();
        if status.is_redirection() {
            let location = response.headers().get(LOCATION)?.to_str().ok()?;
            current = current.join(location).ok()?;
            continue;
        }
        if !status.is_success() {
            return None;
        }
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|val| val.to_str().ok())
            .map(|val| val.to_string());
        let mut buf = Vec::new();
        response
            .take((MAX_AVATAR_BYTES + 1) as u64)
            .read_to_end(&mut buf)
            .ok()?;
        if buf.is_empty() || buf.len() > MAX_AVATAR_BYTES {
            return None;
        }
        let mime = detect_image_mime(content_type.as_deref(), &buf)?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
        return Some(format!("data:{mime};base64,{encoded}"));
    }
    None
}

fn should_send_avatar_cookie(site: &Site, target: &Url) -> bool {
    let (Some(site_host), Some(target_host)) = (site.0.host_str(), target.host_str()) else {
        return false;
    };
    let scheme_ok = target.scheme() == site.0.scheme() || target.scheme() == "https";
    scheme_ok && domain_matches_host(&normalize_host(site_host), &normalize_host(target_host))
}

fn detect_image_mime(header: Option<&str>, bytes: &[u8]) -> Option<&'static str> {
    if let Some(raw) = header {
        let mime = raw
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        match mime.as_str() {
            "image/png" => return Some("image/png"),
            "image/jpeg" | "image/jpg" => return Some("image/jpeg"),
            "image/gif" => return Some("image/gif"),
            "image/webp" => return Some("image/webp"),
            "image/avif" => return Some("image/avif"),
            "image/x-icon" | "image/vnd.microsoft.icon" => return Some("image/x-icon"),
            "" | "application/octet-stream" => {}
            _ => return None,
        }
    }
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn read_body_bytes(response: Response) -> Result<Vec<u8>, String> {
    response
        .bytes()
        .map(|bytes| bytes.to_vec())
        .map_err(|err| format!("读取响应失败：{err}"))
}

fn fetch_session(
    http: &Client,
    provider: &Provider,
    cookie: &Cookie<'_>,
) -> Result<Option<User>, String> {
    let response = get_with(http, provider.site.url("api/sso/session"), Some(cookie))?;
    let status = response.status();
    parse_session_response(status, || read_json(response, "HostID 会话"))
}

fn parse_session_response(
    status: StatusCode,
    read: impl FnOnce() -> Result<Session, String>,
) -> Result<Option<User>, String> {
    if !status.is_success() {
        return Err(format!("HostID 无法校验会话（HTTP {status}）"));
    }
    let session = read()?;
    if !session.authenticated {
        return Ok(None);
    }
    let user = session.user.ok_or("HostID 会话响应缺少用户资料")?;
    Ok(Some(user.validate()?))
}

fn fetch_remote_user(
    http: &Client,
    url: &Url,
    cookie: &Cookie<'_>,
) -> Result<Result<User, StatusCode>, String> {
    let response = get_with(http, url.clone(), Some(cookie))?;
    let status = response.status();
    if !status.is_success() {
        return Ok(Err(status));
    }
    let user = read_json::<User>(response, "远程实例用户")?.validate()?;
    Ok(Ok(user))
}

/// 依次尝试匹配远程实例的共享 Cookie，并在后续 Cookie 成功时返回失效的旧 Cookie 以便清理。
fn verify_remote_cookies(
    cookies: &[Cookie<'static>],
    user: &User,
    mut probe: impl FnMut(&Cookie<'_>) -> Result<Result<User, StatusCode>, String>,
) -> Result<Vec<Cookie<'static>>, String> {
    let mut stale_cookies = Vec::new();
    let mut last_error = None;
    for cookie in cookies {
        match probe(cookie)? {
            Ok(remote_user) if remote_user.id == user.id => return Ok(stale_cookies),
            Ok(_) => {
                last_error = Some(
                    "远程实例返回的用户与 HostID 会话不一致，请检查 SSO 配置和共享 Cookie".into(),
                );
            }
            Err(status) => {
                last_error = Some(format!(
                    "HostID 会话有效，但远程实例未接受该会话（HTTP {status}）"
                ));
            }
        }
        stale_cookies.push(cookie.clone());
    }
    Err(last_error.unwrap_or_else(|| "HostID 会话有效，但远程实例未接受该会话".into()))
}

fn get_with(http: &Client, url: Url, cookie: Option<&Cookie<'_>>) -> Result<Response, String> {
    let mut request = http
        .get(url)
        .header(ACCEPT, "application/json")
        .header(CACHE_CONTROL, "no-cache");
    if let Some(cookie) = cookie {
        request = request.header(COOKIE, cookie_pair(cookie));
    }
    request.send().map_err(|err| {
        if err.is_timeout() {
            "会话校验请求超时，请重试".to_string()
        } else {
            format!("会话校验请求失败：{err}")
        }
    })
}

fn select_cookies(
    mut cookies: Vec<Cookie<'static>>,
    url: &Url,
    name: &str,
    now: SystemTime,
) -> Vec<Cookie<'static>> {
    cookies.retain(|cookie| {
        cookie.name() == name
            && !cookie.value().trim().is_empty()
            && cookie
                .expires_datetime()
                .is_none_or(|expires| expires > now)
            && cookie
                .max_age()
                .is_none_or(|age| !age.is_negative() && !age.is_zero())
    });
    // 与浏览器一致，先使用路径最具体且主机精确匹配的 Cookie。
    cookies.sort_by_key(|cookie| {
        (
            std::cmp::Reverse(normalized_cookie_path(cookie).len()),
            !is_exact_host_cookie(cookie, url),
        )
    });
    cookies
}

fn legacy_provider_bytes(body: &[u8], remembered: Option<&Provider>) -> Result<RemoteAuth, String> {
    let denied: Unauthorized =
        serde_json::from_slice(body).map_err(|_| "远程实例的 401 响应格式无效".to_string())?;
    if denied.error != "unauthorized" {
        return Err("远程实例拒绝请求，未提供 HostID 登录信息".into());
    }
    let login = Url::parse(&denied.login_url).map_err(|_| "远程实例返回的 HostID 登录地址无效")?;
    let site = Site::from_login_url(&login)?;
    let cookie_name = remembered
        .filter(|provider| provider.site.base() == site.base())
        .map(|provider| provider.cookie_name.as_str())
        .unwrap_or(DEFAULT_COOKIE)
        .to_string();
    Ok(RemoteAuth::HostId(Provider { site, cookie_name }))
}

fn read_json<T: serde::de::DeserializeOwned>(
    response: Response,
    context: &str,
) -> Result<T, String> {
    response
        .json()
        .map_err(|_| format!("{context}响应格式无效"))
}

fn cookie_pair(cookie: &Cookie<'_>) -> String {
    format!("{}={}", cookie.name(), cookie.value())
}

fn normalize_host(raw: &str) -> String {
    raw.trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.')
        .to_ascii_lowercase()
}

fn normalize_domain(raw: &str) -> String {
    normalize_host(raw.trim_start_matches('.'))
}

fn normalized_cookie_path<'a>(cookie: &'a Cookie<'_>) -> &'a str {
    cookie
        .path()
        .filter(|path| path.starts_with('/'))
        .unwrap_or("/")
}

fn is_exact_host_cookie(cookie: &Cookie<'_>, url: &Url) -> bool {
    let (Some(raw_domain), Some(raw_host)) = (cookie.domain(), url.host_str()) else {
        return false;
    };
    let domain = normalize_domain(raw_domain);
    let host = normalize_host(raw_host);
    !domain.is_empty() && domain == host
}

fn domain_matches_host(domain: &str, host: &str) -> bool {
    if domain.is_empty() || host.is_empty() {
        return false;
    }
    if host.parse::<IpAddr>().is_ok() {
        host == domain
    } else {
        host == domain
            || host
                .strip_suffix(domain)
                .is_some_and(|prefix| prefix.ends_with('.'))
    }
}

fn is_loopback_host(host: &str) -> bool {
    host == "localhost"
        || host.ends_with(".localhost")
        || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

fn is_loopback_url(url: &Url) -> bool {
    url.host_str()
        .is_some_and(|raw| is_loopback_host(&normalize_host(raw)))
}

/// 判定 WKWebView Cookie 是否应发送到目标 URL（`wry` 通过 `CookieBuilder` 构造 Cookie，
/// 会丢失 `domain_raw` 和前导点前缀，因此必须统一基于规范化后的 `cookie.domain()` 匹配）。
#[cfg(any(target_os = "macos", test))]
fn matches_wk_cookie(cookie: &Cookie<'_>, url: &Url) -> bool {
    let (Some(raw_domain), Some(raw_host)) = (cookie.domain(), url.host_str()) else {
        return false;
    };
    let domain = normalize_domain(raw_domain);
    let host = normalize_host(raw_host);
    let domain_matches = domain_matches_host(&domain, &host);
    let path = normalized_cookie_path(cookie);
    let path_matches = url.path() == path
        || url
            .path()
            .strip_prefix(path)
            .is_some_and(|rest| path.ends_with('/') || rest.starts_with('/'));
    let scheme_matches =
        !cookie.secure().unwrap_or(false) || url.scheme() == "https" || is_loopback_host(&host);
    domain_matches && path_matches && scheme_matches
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::webview::cookie::time::{Duration as CookieDuration, OffsetDateTime};

    #[test]
    fn wk_cookie_matches_shared_domain_built_by_cookie_builder() {
        // wry 通过 CookieBuilder 构造 WKHTTPCookie，此时 domain_raw() 为 None，
        // 且 domain() 会去掉前导 '.'。
        let cookie = Cookie::build(("sso_token", "jwt-token"))
            .domain(".ginpika.cc")
            .path("/")
            .secure(true)
            .http_only(true)
            .build();
        assert!(cookie.domain_raw().is_none());

        assert!(matches_wk_cookie(
            &cookie,
            &Url::parse("https://mail.ginpika.cc/api/sso/session").unwrap()
        ));
        assert!(matches_wk_cookie(
            &cookie,
            &Url::parse("https://minis.ginpika.cc/api/auth/me").unwrap()
        ));
        assert!(matches_wk_cookie(
            &cookie,
            &Url::parse("https://ginpika.cc/").unwrap()
        ));
        assert!(matches_wk_cookie(
            &cookie,
            &Url::parse("https://MAIL.GINPIKA.CC./api/sso/session").unwrap()
        ));
        assert!(!matches_wk_cookie(
            &cookie,
            &Url::parse("https://evilginpika.cc/api/sso/session").unwrap()
        ));
        assert!(!matches_wk_cookie(
            &cookie,
            &Url::parse("http://mail.ginpika.cc/api/sso/session").unwrap()
        ));
    }

    #[test]
    fn wk_cookie_enforces_host_path_ip_and_loopback_rules() {
        let host_only = Cookie::build(("sso_token", "jwt"))
            .domain("mail.ginpika.cc")
            .path("/api")
            .secure(true)
            .build();
        assert!(matches_wk_cookie(
            &host_only,
            &Url::parse("https://mail.ginpika.cc/api").unwrap()
        ));
        assert!(matches_wk_cookie(
            &host_only,
            &Url::parse("https://mail.ginpika.cc/api/sso/session").unwrap()
        ));
        assert!(!matches_wk_cookie(
            &host_only,
            &Url::parse("https://mail.ginpika.cc/apiv2").unwrap()
        ));
        assert!(!matches_wk_cookie(
            &host_only,
            &Url::parse("https://minis.ginpika.cc/api/sso/session").unwrap()
        ));

        let ip_cookie = Cookie::build(("sso_token", "jwt"))
            .domain("0.0.1")
            .path("/")
            .secure(true)
            .build();
        assert!(!matches_wk_cookie(
            &ip_cookie,
            &Url::parse("http://127.0.0.1/api/sso/session").unwrap()
        ));

        let loopback = Cookie::build(("sso_token", "jwt"))
            .domain("localhost")
            .path("/")
            .secure(true)
            .build();
        assert!(matches_wk_cookie(
            &loopback,
            &Url::parse("http://localhost:3000/api/sso/session").unwrap()
        ));

        let v6_loopback = Cookie::build(("sso_token", "jwt"))
            .domain("::1")
            .path("/")
            .secure(true)
            .build();
        assert!(matches_wk_cookie(
            &v6_loopback,
            &Url::parse("http://[::1]:3000/api/sso/session").unwrap()
        ));

        let empty_domain = Cookie::build(("sso_token", "jwt"))
            .domain(".")
            .path("/")
            .build();
        assert!(!matches_wk_cookie(
            &empty_domain,
            &Url::parse("https://mail.ginpika.cc/").unwrap()
        ));
    }

    #[test]
    fn select_cookies_filters_and_sorts_by_path_then_exact_host() {
        let now = SystemTime::now();
        let target = Url::parse("https://mail.ginpika.cc/api/sso/session").unwrap();
        let expired_date = Cookie::build(("sso_token", "expired-date"))
            .domain(".ginpika.cc")
            .path("/")
            .expires(OffsetDateTime::now_utc() - CookieDuration::seconds(10))
            .build();
        let expired_max_age = Cookie::build(("sso_token", "expired-age"))
            .domain(".ginpika.cc")
            .path("/")
            .max_age(CookieDuration::seconds(0))
            .build();
        let blank = Cookie::build(("sso_token", "   "))
            .domain(".ginpika.cc")
            .path("/")
            .build();
        let other = Cookie::build(("other", "val"))
            .domain(".ginpika.cc")
            .path("/")
            .build();
        let shared = Cookie::build(("sso_token", "shared"))
            .domain(".ginpika.cc")
            .path("/")
            .build();
        let exact_root = Cookie::build(("sso_token", "exact-root"))
            .domain("mail.ginpika.cc")
            .path("/")
            .build();
        let deep_path = Cookie::build(("sso_token", "deep-path"))
            .domain(".ginpika.cc")
            .path("/api/sso")
            .build();

        let filtered: Vec<_> = vec![
            expired_date,
            expired_max_age,
            blank,
            other,
            shared,
            exact_root,
            deep_path,
        ]
        .into_iter()
        .filter(|c| matches_wk_cookie(c, &target))
        .collect();
        let sorted = select_cookies(filtered, &target, "sso_token", now);
        let values: Vec<_> = sorted.iter().map(|c| c.value()).collect();
        assert_eq!(values, vec!["deep-path", "exact-root", "shared"]);
    }

    #[test]
    fn parse_session_response_handles_live_hostid_payload_and_errors() {
        let payload = r#"{"authenticated":true,"user":{"id":"cmowth61f00006vsg0d6vipd4","username":"root","nickname":null,"email":"root@ginpika.cc","role":"admin","avatar":"cmowth61f00006vsg0d6vipd4.png","avatarUrl":"https://mail.ginpika.cc/api/auth/avatar/cmowth61f00006vsg0d6vipd4.png"}}"#;
        let user = parse_session_response(StatusCode::OK, || {
            serde_json::from_str(payload).map_err(|err| err.to_string())
        })
        .unwrap()
        .unwrap();
        assert_eq!(user.id, "cmowth61f00006vsg0d6vipd4");
        assert_eq!(user.username, "root");
        assert!(user.nickname.is_none());
        assert_eq!(user.email.as_deref(), Some("root@ginpika.cc"));

        let unauth = parse_session_response(StatusCode::OK, || {
            serde_json::from_str(r#"{"authenticated":false}"#).map_err(|err| err.to_string())
        })
        .unwrap();
        assert!(unauth.is_none());

        let err = parse_session_response(StatusCode::INTERNAL_SERVER_ERROR, || {
            unreachable!("non-2xx should fail before parsing JSON")
        })
        .err()
        .unwrap();
        assert!(err.contains("HTTP 500"));
    }

    #[test]
    fn verify_remote_cookies_skips_stale_cookie_and_reports_cleanup() {
        let hostid_user = User {
            id: "user-1".into(),
            username: "root".into(),
            nickname: None,
            email: Some("root@ginpika.cc".into()),
            avatar_url: None,
            avatar: None,
        };
        let stale = Cookie::build(("sso_token", "stale-tok")).build();
        let fresh = Cookie::build(("sso_token", "fresh-tok")).build();

        let stale_returned = verify_remote_cookies(&[stale, fresh], &hostid_user, |cookie| {
            if cookie.value() == "stale-tok" {
                Ok(Err(StatusCode::UNAUTHORIZED))
            } else {
                Ok(Ok(User {
                    id: "user-1".into(),
                    username: "root".into(),
                    nickname: None,
                    email: None,
                    avatar_url: None,
                    avatar: None,
                }))
            }
        })
        .unwrap();
        assert_eq!(stale_returned.len(), 1);
        assert_eq!(stale_returned[0].value(), "stale-tok");
    }

    #[test]
    fn verify_remote_cookies_rejects_mismatched_user_id() {
        let hostid_user = User {
            id: "user-1".into(),
            username: "root".into(),
            nickname: None,
            email: None,
            avatar_url: None,
            avatar: None,
        };
        let cookie = Cookie::build(("sso_token", "tok-2")).build();

        let err = verify_remote_cookies(&[cookie], &hostid_user, |_| {
            Ok(Ok(User {
                id: "user-2".into(),
                username: "other".into(),
                nickname: None,
                email: None,
                avatar_url: None,
                avatar: None,
            }))
        })
        .unwrap_err();
        assert!(err.contains("用户与 HostID 会话不一致"));
    }

    #[test]
    fn remote_auth_handles_loopback_dev_server_without_sso() {
        // Vite 5173 返回 SPA HTML 或代理 5xx 时，本地回环实例判定为未启用 SSO。
        assert!(matches!(
            classify_sso_probe(StatusCode::OK, b"<!doctype html><html></html>", true, None)
                .unwrap(),
            Some(RemoteAuth::Available)
        ));
        assert!(matches!(
            classify_sso_probe(StatusCode::BAD_GATEWAY, b"", true, None).unwrap(),
            Some(RemoteAuth::Available)
        ));
        assert!(matches!(
            classify_sso_probe(StatusCode::OK, br#"{"enabled":false}"#, true, None).unwrap(),
            Some(RemoteAuth::Available)
        ));
        assert!(classify_sso_probe(StatusCode::NOT_FOUND, b"", true, None)
            .unwrap()
            .is_none());
        assert!(matches!(
            classify_legacy_me_probe(StatusCode::OK, b"<html></html>", true, None).unwrap(),
            RemoteAuth::Available
        ));
        assert!(matches!(
            classify_legacy_me_probe(StatusCode::NOT_FOUND, b"", true, None).unwrap(),
            RemoteAuth::Available
        ));

        // 即使在回环地址上，明确返回 SSO 配置或 401 时仍必须走 HostID 登录。
        let sso_enabled =
            br#"{"enabled":true,"serverUrl":"https://mail.ginpika.cc","cookieName":"sso_token"}"#;
        assert!(matches!(
            classify_sso_probe(StatusCode::OK, sso_enabled, true, None).unwrap(),
            Some(RemoteAuth::HostId(_))
        ));
        let unauth = br#"{"error":"unauthorized","loginUrl":"https://mail.ginpika.cc/sso/login"}"#;
        assert!(matches!(
            classify_sso_probe(StatusCode::UNAUTHORIZED, unauth, true, None).unwrap(),
            Some(RemoteAuth::HostId(_))
        ));

        // 非本地实例保持严格校验，不允许 HTML 或 5xx 绕过检查。
        assert!(classify_sso_probe(StatusCode::OK, b"<html></html>", false, None).is_err());
        assert!(classify_sso_probe(StatusCode::BAD_GATEWAY, b"", false, None).is_err());
    }

    #[test]
    fn avatar_resolution_and_security_guards_work() {
        let site = Site::parse("https://mail.ginpika.cc").unwrap();
        assert_eq!(
            resolve_avatar_url(
                &site,
                Some("https://mail.ginpika.cc/api/auth/avatar/u1.png"),
                Some("u1.png")
            )
            .as_deref(),
            Some("https://mail.ginpika.cc/api/auth/avatar/u1.png")
        );
        assert_eq!(
            resolve_avatar_url(&site, None, Some("cmowth61f00006vsg0d6vipd4.png")).as_deref(),
            Some("https://mail.ginpika.cc/api/auth/avatar/cmowth61f00006vsg0d6vipd4.png")
        );
        assert_eq!(
            resolve_avatar_url(&site, Some("/api/auth/avatar/u1.png"), None).as_deref(),
            Some("https://mail.ginpika.cc/api/auth/avatar/u1.png")
        );

        assert!(should_send_avatar_cookie(
            &site,
            &Url::parse("https://mail.ginpika.cc/api/auth/avatar/u1.png").unwrap()
        ));
        assert!(!should_send_avatar_cookie(
            &site,
            &Url::parse("https://avatars.githubusercontent.com/u/1").unwrap()
        ));

        assert_eq!(
            detect_image_mime(Some("image/png; charset=utf-8"), b""),
            Some("image/png")
        );
        assert_eq!(detect_image_mime(Some("image/svg+xml"), b"<svg/>"), None);
        assert_eq!(
            detect_image_mime(Some("application/octet-stream"), b"\x89PNG\r\n\x1a\n123"),
            Some("image/png")
        );
        assert_eq!(detect_image_mime(Some("text/html"), b"<html>"), None);
    }
}

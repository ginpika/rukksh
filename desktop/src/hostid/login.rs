use super::session::{Provider, SessionClient, User};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::webview::Cookie;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub(super) const LOGIN_LABEL: &str = "hostid-login";
const POLL_INTERVAL: Duration = Duration::from_millis(250);
const RETRY_INTERVAL: Duration = Duration::from_secs(2);
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(6);
const WINDOW_CLOSE_WAIT: Duration = Duration::from_millis(500);

pub(super) fn authenticate(
    app: &AppHandle,
    client: &SessionClient,
    provider: &Provider,
    on_login_required: impl FnOnce() -> Result<(), String>,
) -> Result<Option<User>, String> {
    let mut rejected = HashSet::new();
    for cookie in client.hostid_cookies(provider)? {
        if rejected.contains(cookie.value()) {
            continue;
        }
        if let Some(user) = client.session(provider, &cookie)? {
            return Ok(Some(user));
        }
        rejected.insert(cookie.value().to_string());
    }
    on_login_required()?;
    wait_for_login(app, client, provider, rejected)
}

fn wait_for_login(
    app: &AppHandle,
    client: &SessionClient,
    provider: &Provider,
    mut rejected: HashSet<String>,
) -> Result<Option<User>, String> {
    close_existing_login_window(app);

    let mut callback = provider.site.url("__rukksh_sso_done");
    callback
        .query_pairs_mut()
        .append_pair("attempt", &uuid::Uuid::new_v4().to_string());
    let mut login = provider.site.url("sso/login");
    login
        .query_pairs_mut()
        .append_pair("redirect", callback.as_str());

    let redirected = Arc::new(AtomicBool::new(false));
    let callback_arrived = redirected.clone();
    let callback_match = callback;
    let window = WebviewWindowBuilder::new(app, LOGIN_LABEL, WebviewUrl::External(login))
        .title("登录 HostID")
        .inner_size(520.0, 806.0)
        .min_inner_size(420.0, 640.0)
        .center()
        .on_navigation(move |nav| {
            if matches_callback(nav, &callback_match) {
                callback_arrived.store(true, Ordering::Release);
                return false;
            }
            true
        })
        .build()
        .map_err(|err| format!("无法打开 HostID 登录窗口：{err}"))?;

    let result = (|| {
        let mut retry_after: HashMap<String, Instant> = HashMap::new();
        let mut deadline = None;
        let mut last_error: Option<String> = None;

        while app.get_webview_window(LOGIN_LABEL).is_some() {
            if redirected.swap(false, Ordering::AcqRel) {
                // 登录回跳到达时允许立即复检 Cookie，覆盖先前的短暂失败或过期缓存。
                rejected.clear();
                retry_after.clear();
                deadline = Some(Instant::now() + CALLBACK_TIMEOUT);
            }

            match read_login_cookies(&window, client, provider) {
                Ok(cookies) => {
                    rejected.retain(|val| cookies.iter().any(|cookie| cookie.value() == val));
                    retry_after.retain(|val, _| cookies.iter().any(|cookie| cookie.value() == val));

                    let now = Instant::now();
                    for cookie in cookies {
                        let value = cookie.value();
                        if rejected.contains(value)
                            || retry_after.get(value).is_some_and(|until| now < *until)
                        {
                            continue;
                        }
                        match client.session(provider, &cookie) {
                            Ok(Some(user)) => return Ok(Some(user)),
                            Ok(None) => {
                                rejected.insert(value.to_string());
                                retry_after.remove(value);
                                last_error = None;
                            }
                            Err(err) => {
                                last_error = Some(err);
                                retry_after.insert(value.to_string(), now + RETRY_INTERVAL);
                            }
                        }
                    }
                }
                Err(err) => {
                    last_error = Some(err);
                }
            }

            if deadline.is_some_and(|until| Instant::now() >= until) {
                let message = last_error.take().unwrap_or_else(|| {
                    "未收到有效的 HostID Cookie。请在登录窗口退出当前账户后重试，或检查 Cookie 配置"
                        .into()
                });
                crate::emit_status(app, "boot", &message);
                deadline = None;
            }
            std::thread::sleep(POLL_INTERVAL);
        }
        Ok(None)
    })();
    if app.get_webview_window(LOGIN_LABEL).is_some() {
        let _ = window.destroy();
    }
    result
}

fn close_existing_login_window(app: &AppHandle) {
    let Some(existing) = app.get_webview_window(LOGIN_LABEL) else {
        return;
    };
    let _ = existing.destroy();
    let deadline = Instant::now() + WINDOW_CLOSE_WAIT;
    while app.get_webview_window(LOGIN_LABEL).is_some() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn read_login_cookies(
    window: &WebviewWindow,
    client: &SessionClient,
    provider: &Provider,
) -> Result<Vec<Cookie<'static>>, String> {
    match client.hostid_cookies_on(window.as_ref(), provider) {
        Ok(cookies) if !cookies.is_empty() => Ok(cookies),
        #[cfg(target_os = "macos")]
        Ok(_) => Ok(Vec::new()),
        #[cfg(not(target_os = "macos"))]
        Ok(_) => client.hostid_cookies(provider),
        Err(err) => client.hostid_cookies(provider).or(Err(err)),
    }
}

fn matches_callback(nav: &Url, callback: &Url) -> bool {
    nav.origin() == callback.origin() && nav.path() == callback.path()
}

#[cfg(test)]
mod tests {
    use super::matches_callback;
    use tauri::Url;

    #[test]
    fn matches_callback_by_origin_and_path_ignoring_query_variations() {
        let callback = Url::parse("https://mail.ginpika.cc/__rukksh_sso_done?attempt=1234").unwrap();

        assert!(matches_callback(
            &Url::parse("https://mail.ginpika.cc/__rukksh_sso_done?attempt=1234").unwrap(),
            &callback
        ));
        assert!(matches_callback(
            &Url::parse("https://mail.ginpika.cc/__rukksh_sso_done").unwrap(),
            &callback
        ));
        assert!(matches_callback(
            &Url::parse("https://mail.ginpika.cc/__rukksh_sso_done?foo=bar").unwrap(),
            &callback
        ));
        assert!(!matches_callback(
            &Url::parse("https://mail.ginpika.cc/login?redirect=x").unwrap(),
            &callback
        ));
        assert!(!matches_callback(
            &Url::parse("https://other.ginpika.cc/__rukksh_sso_done?attempt=1234").unwrap(),
            &callback
        ));
    }
}

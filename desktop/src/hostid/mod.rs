//! HostID 会话、登录、登出和远程实例的认证入口。

mod login;
mod session;
#[cfg(target_os = "macos")]
mod wk_cookie;

use crate::{
    backend, config, current_instance_session, emit_status, emit_users, enter_instance,
    main_webview, navigate, notify_main, return_to_launcher, set_choice, set_instance_session,
    Shell,
};
use session::{Provider, RemoteAuth, SessionClient, Site, User, DEFAULT_COOKIE};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, Url};

pub(super) const LOGOUT_PATH: &str = "/__rukksh_desktop_logout";

#[derive(Default)]
pub(super) struct State {
    busy: AtomicBool,
}

struct Operation<'a>(&'a AtomicBool);

impl Drop for Operation<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

pub(super) fn ensure_idle(app: &AppHandle) -> Result<(), String> {
    if app.state::<State>().busy.load(Ordering::Acquire) {
        return Err("HostID 操作正在进行，请稍后再试".into());
    }
    Ok(())
}

fn start(
    app: AppHandle,
    work: impl FnOnce(&AppHandle) -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    if app.state::<State>().busy.swap(true, Ordering::AcqRel) {
        return Err("HostID 操作正在进行，请稍后再试".into());
    }
    // WebView2 在同步命令和窗口回调中读取 Cookie 或创建新窗口会死锁。
    std::thread::spawn(move || {
        let state = app.state::<State>();
        let _operation = Operation(&state.busy);
        if let Err(err) = work(&app) {
            emit_status(&app, "error", &err);
            notify_main(&app, &err);
        }
    });
    Ok(())
}

#[tauri::command]
pub(super) fn desktop_hostid_base(app: AppHandle) -> String {
    config::load(&app).hostid_base_url
}

#[tauri::command]
pub(super) fn desktop_login_hostid(app: AppHandle, url: String) -> Result<(), String> {
    let site = Site::parse(&url)?;
    start(app, move |app| {
        let cfg = config::load(app);
        let cookie_name = if is_remembered_provider(&cfg, &site) {
            remembered_cookie_name(&cfg)
        } else {
            DEFAULT_COOKIE.into()
        };
        let provider = Provider { site, cookie_name };
        emit_status(app, "boot", "正在校验 HostID 会话…");
        let client = client(app)?;
        let mut opened_login = false;
        match login::authenticate(app, &client, &provider, || {
            opened_login = true;
            require_login(app, &provider)
        })? {
            Some(user) => {
                save_user(app, &provider, &user)?;
                emit_status(app, "idle", "");
                if opened_login {
                    notify_main(app, "HostID 登录成功");
                } else {
                    notify_main(
                        app,
                        &format!(
                            "已登录 HostID（{}），无需重复登录；如需切换账号请先退出",
                            display_name(&user)
                        ),
                    );
                }
            }
            None => emit_status(app, "idle", "已取消登录"),
        }
        Ok(())
    })
}

#[tauri::command]
pub(super) fn desktop_relogin_hostid(app: AppHandle) -> Result<(), String> {
    let base = config::load(&app).hostid_base_url;
    if base.is_empty() {
        return Err("尚未配置 HostID 地址".into());
    }
    desktop_login_hostid(app, base)
}

#[tauri::command]
pub(super) fn desktop_dismiss_session_notice(app: AppHandle) {
    set_session_expired(&app, false);
}

#[tauri::command]
pub(super) fn desktop_choose_remote(app: AppHandle, url: String) -> Result<(), String> {
    let site = Site::parse(&url)?;
    start(app, move |app| {
        config::update(app, |cfg| {
            cfg.mode = config::Mode::Remote;
            cfg.remote_base_url = site.base().to_string();
            Ok(())
        })?;
        set_choice(app, config::Mode::Remote, site.base());
        set_instance_session(app, None);
        set_session_expired(app, false);
        backend::stop(app);
        connect(app, &site, site.url("").as_str(), Entry::Connect)
    })
}

pub(super) fn resume_remote(app: AppHandle, url: String) -> Result<(), String> {
    let site = Site::parse(&config::load(&app).remote_base_url)?;
    if Url::parse(&url)
        .map_err(|err| format!("实例地址无效：{err}"))?
        .origin()
        != site.url("").origin()
    {
        return Err("实例地址已变更，请重新连接".into());
    }
    start(app, move |app| connect(app, &site, &url, Entry::Resume))
}

#[derive(PartialEq, Eq)]
enum Entry {
    Connect,
    Resume,
    LoginRedirect,
}

fn connect(app: &AppHandle, site: &Site, target: &str, entry: Entry) -> Result<(), String> {
    emit_status(app, "boot", "正在校验远程实例会话…");
    let client = client(app)?;
    let mut opened_login = false;
    let remembered = remembered_provider(&config::load(app));
    if let RemoteAuth::HostId(provider) = client.remote_auth(site, remembered.as_ref())? {
        let user = login::authenticate(app, &client, &provider, || {
            opened_login = true;
            require_login(app, &provider)
        })?;
        let Some(user) = user else {
            emit_status(app, "idle", "已取消登录");
            return Ok(());
        };
        save_user(app, &provider, &user)?;
        client.verify_remote(site, &provider, &user)?;
    }
    if entry == Entry::LoginRedirect && !opened_login {
        return Err(
            "会话校验已通过，但远程实例仍重定向到登录页。请检查实例的共享 Cookie 和代理配置".into(),
        );
    }
    if entry == Entry::Resume && !opened_login {
        emit_status(app, "remote", "已校验远程实例会话");
        if !navigate(app, target) {
            set_instance_session(app, None);
        }
    } else {
        enter_instance(app, target, "remote");
    }
    Ok(())
}

pub(super) fn intercept_navigation(app: &AppHandle, nav: &Url) -> bool {
    let Some(instance) = current_instance_session(app).filter(|instance| instance.mode == "remote")
    else {
        return true;
    };
    let Ok(instance_url) = Url::parse(&instance.url) else {
        return true;
    };
    if nav.path() == LOGOUT_PATH && nav.origin() == instance_url.origin() {
        let _ = start(app.clone(), |app| {
            let provider = remembered_provider(&config::load(app));
            let result = provider
                .as_ref()
                .map_or(Ok(()), |provider| client(app)?.clear_cookies(provider));
            let identity = forget_user(app);
            set_session_expired(app, provider.is_some());
            return_to_launcher(app, Some("已退出登录，正在返回…"));
            identity.and(result)
        });
        return false;
    }
    let Ok(provider) = Site::from_login_url(nav) else {
        return true;
    };
    let cfg = config::load(app);
    let Ok(remote) = Site::parse(&cfg.remote_base_url) else {
        return true;
    };
    let Some(redirect) = nav
        .query_pairs()
        .find(|(key, _)| key == "redirect")
        .and_then(|(_, value)| Url::parse(&value).ok())
    else {
        return true;
    };
    if redirect.origin() != instance_url.origin() && !is_remembered_provider(&cfg, &provider) {
        return true;
    }
    let _ = start(app.clone(), move |app| {
        return_to_launcher(app, Some("正在重新校验 HostID 会话…"));
        connect(app, &remote, instance_url.as_str(), Entry::LoginRedirect)
    });
    false
}

#[tauri::command]
pub(super) fn desktop_logout_hostid(app: AppHandle) -> Result<(), String> {
    start(app, |app| {
        let provider = remembered_provider(&config::load(app));
        forget_user(app)?;
        set_session_expired(app, false);
        if let Some(provider) = provider {
            client(app)?.logout(&provider)?;
        }
        notify_main(app, "已退出 HostID 登录");
        Ok(())
    })
}

fn require_login(app: &AppHandle, provider: &Provider) -> Result<(), String> {
    if is_remembered_provider(&config::load(app), &provider.site) {
        forget_user(app)?;
        set_session_expired(app, true);
    }
    emit_status(app, "boot", "请在登录窗口完成 HostID 登录");
    Ok(())
}

pub(super) fn set_session_expired(app: &AppHandle, expired: bool) {
    app.state::<Shell>().status.lock().unwrap().session_expired = expired;
}

fn client(app: &AppHandle) -> Result<SessionClient, String> {
    SessionClient::new(main_webview(app).ok_or("主窗口已关闭")?)
}

fn remembered_provider(cfg: &config::Config) -> Option<Provider> {
    Some(Provider {
        site: Site::parse(&cfg.hostid_base_url).ok()?,
        cookie_name: remembered_cookie_name(cfg),
    })
}

fn remembered_cookie_name(cfg: &config::Config) -> String {
    if cfg.hostid_cookie_name.is_empty() {
        DEFAULT_COOKIE.into()
    } else {
        cfg.hostid_cookie_name.clone()
    }
}

fn is_remembered_provider(cfg: &config::Config, site: &Site) -> bool {
    Site::parse(&cfg.hostid_base_url).is_ok_and(|remembered| remembered.base() == site.base())
}

fn display_name(user: &User) -> &str {
    user.nickname
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| user.username.trim())
}

fn save_user(app: &AppHandle, provider: &Provider, user: &User) -> Result<(), String> {
    let name = display_name(user);
    config::update(app, |cfg| {
        cfg.hostid_base_url = provider.site.base().to_string();
        cfg.hostid_cookie_name = provider.cookie_name.clone();
        cfg.sso_user_name = name.to_string();
        cfg.sso_user_avatar = user.avatar_url.clone().unwrap_or_default();
        cfg.sso_user_email = user.email.clone().unwrap_or_default();
        cfg.current_user = "sso".into();
        Ok(())
    })?;
    set_session_expired(app, false);
    emit_users(app);
    Ok(())
}

fn forget_user(app: &AppHandle) -> Result<(), String> {
    config::update(app, |cfg| {
        cfg.sso_user_name.clear();
        cfg.sso_user_avatar.clear();
        cfg.sso_user_email.clear();
        if cfg.current_user == "sso" {
            cfg.current_user = "local".into();
        }
        Ok(())
    })?;
    emit_users(app);
    Ok(())
}

pub(super) fn close_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(login::LOGIN_LABEL) {
        let _ = window.destroy();
    }
}

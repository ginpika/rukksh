//! minis 桌面壳（Tauri 2）：把「本机后端」与「远程后端」两种模式收在同一个应用里。
//!
//! - 本机模式：壳拉起内置 JRE + fat jar 作为 sidecar，只绑回环、随机端口；壳每次启动生成
//!   一次性令牌，既作为环境变量传给后端（DesktopTokenFilter 校验），也交给本机后端的主页面，
//!   前端统一在请求头带回来。固定本地单用户，不走 SSO。
//! - 远程模式：不启动 sidecar，窗口直接加载服务端站点，进入前由 hostid 模块校验共享会话。
//!
//! 两种模式的共同点：实例最终落在一个 **同源 HTTP 地址** 上（本机 `http://127.0.0.1:{端口}`、
//! 远程 `https://{域名}`），所以前端那份「相对 /api + Cookie + SSE」的代码一行都不用改。
//!
//! 一个窗口、一个 webview：引导页与实例页是同一个 webview 的两份 document，靠**导航**互换
//! （一个 webview 只能显示一份 document，导航必然销毁旧文档；想让实例页在后台常驻就得再加一个
//! webview，这里不走那条路）。所以「回到实例」靠**保存 / 恢复状态**：
//!   · 离开实例前，把它的当前地址（含 #hash 路由）记进壳状态（见 open_launcher_home）；
//!   · 引导页据此把对应卡片换成「回到实例」，点它直接导航回那个地址（见 desktop_show_instance）；
//!   · 会话（本机一次性令牌 / hostid cookie）与业务数据都在后端，主题、聊天会话等前端状态已在
//!     localStorage，重新渲染后自然回到离开时的位置与内容。
//! 只有「首次进入 / 登出」铺高斯模糊加载层；引导页与实例页之间的来回是直接导航。
//!
//! 启动一律停在自带的引导页（ui/index.html）：由用户当场选本机还是远程，壳不自动连任何一个。
//! 选本机就拉起 sidecar；选远程则先校验会话再进入实例。选择会写进配置，
//! 下次进来在引导页上做默认高亮。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend;
mod computer;
mod config;
mod economy_capture;
mod hostid;

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::webview::PageLoadEvent;
use tauri::window::EffectsBuilder;
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, Webview, WebviewUrl, WebviewWindowBuilder,
};

/// 引导页订阅的状态事件名
const STATUS_EVENT: &str = "minis://status";
/// 引导页订阅的用户事件名（当前用户 / 本地用户 / hostid SSO 用户有变即推一份）
const USER_EVENT: &str = "minis://user";
/// 主窗口标签（capabilities 里也按它授权）：单窗口单 webview，
/// 引导页与实例页是它先后加载的两份 document（见文件头说明）
const WINDOW_LABEL: &str = "main";
/// 首页哨兵路径：实例页标题栏的首页按钮往这里导航，主窗口的 on_navigation 会拦下它并带回
/// 引导页（壳页面）。与登出同走导航拦截，但不撤销会话。
const HOME_PATH: &str = "/__minis_desktop_home";
/// 进入实例时的过渡层脚本：实例页文档创建（PageLoadEvent::Started）时铺一层高斯模糊 +
/// 居中转圈，页面就绪后自己渐出（模糊 → 清晰）并移除。与引导页那层同款参数，
/// 于是「引导页模糊 → 跳转 → 实例页模糊 → 清晰」看起来是同一层动画，跳转被藏在里面。
const ENTER_VEIL_JS: &str = r#"(function () {
  var id = '__minis_enter_veil__';
  if (document.getElementById(id)) return;

  var dark = false;
  try {
    var raw = localStorage.getItem('minis.theme.v4');
    var parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.scheme) dark = parsed.scheme === 'dark';
    else if (document.documentElement.dataset.scheme) dark = document.documentElement.dataset.scheme === 'dark';
    else dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch (e) {
    dark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  var mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);

  var style = document.createElement('style');
  style.textContent = '@keyframes minis-enter-spin{to{transform:rotate(360deg)}}';
  (document.head || document.documentElement).appendChild(style);

  var el = document.createElement('div');
  el.id = id;
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:55', 'overflow:hidden',
    'border-radius:' + (mac ? '0' : '20px'),
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:' + (dark ? 'rgba(16,18,19,.55)' : 'rgba(255,255,255,.55)'),
    'backdrop-filter:blur(14px)', '-webkit-backdrop-filter:blur(14px)',
    'opacity:1', 'transition:opacity .6s ease,backdrop-filter .6s ease'
  ].join(';');
  var spinner = document.createElement('span');
  spinner.style.cssText = [
    'width:28px', 'height:28px',
    'border:2px solid ' + (dark ? 'rgba(230,237,243,.16)' : 'rgba(31,35,40,.14)'),
    'border-top-color:' + (dark ? '#e6edf3' : '#1f2328'),
    'border-radius:999px', 'animation:minis-enter-spin .8s linear infinite'
  ].join(';');
  el.appendChild(spinner);
  (document.body || document.documentElement).appendChild(el);

  var adopted = false;
  function adopt() {
    if (adopted) return true;
    var host = document.querySelector('.df__view');
    if (!host) return false;
    adopted = true;
    el.style.position = 'absolute';
    el.style.borderRadius = 'inherit';
    host.appendChild(el);
    return true;
  }
  var tries = 0;
  var timer = setInterval(function () {
    if (adopt() || ++tries > 80) clearInterval(timer);
  }, 50);

  function fade() {
    adopt();
    el.style.opacity = '0';
    el.style.backdropFilter = 'blur(0px)';
    el.style.webkitBackdropFilter = 'blur(0px)';
    el.style.pointerEvents = 'none';
    setTimeout(function () { el.remove(); style.remove(); }, 700);
  }
  function arm() { setTimeout(fade, 400); }
  if (document.readyState === 'complete') arm();
  else window.addEventListener('load', arm, { once: true });
  setTimeout(fade, 6000);
})();"#;

/// 离开实例时的过渡层脚本：在当前页主视图内容区上渐入高斯模糊 + 居中转圈（清晰 → 模糊），
/// 停留不动——随后壳在模糊层下把窗口带回引导页（见 return_to_launcher）。
const EXIT_VEIL_JS: &str = r#"(function () {
  var id = '__minis_exit_veil__';
  if (document.getElementById(id)) return;
  var dark = document.documentElement.dataset.scheme === 'dark' ||
    (!document.documentElement.dataset.scheme && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

  var style = document.createElement('style');
  style.textContent = '@keyframes minis-enter-spin{to{transform:rotate(360deg)}}';
  (document.head || document.documentElement).appendChild(style);

  var el = document.createElement('div');
  el.id = id;
  el.style.cssText = [
    'position:absolute', 'inset:0', 'z-index:2147483646', 'overflow:hidden',
    'border-radius:inherit',
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:' + (dark ? 'rgba(16,18,19,.55)' : 'rgba(255,255,255,.55)'),
    'backdrop-filter:blur(0px)', '-webkit-backdrop-filter:blur(0px)',
    'opacity:0', 'transition:opacity .6s ease,backdrop-filter .6s ease'
  ].join(';');
  var spinner = document.createElement('span');
  spinner.style.cssText = [
    'width:28px', 'height:28px',
    'border:2px solid ' + (dark ? 'rgba(230,237,243,.16)' : 'rgba(31,35,40,.14)'),
    'border-top-color:' + (dark ? '#e6edf3' : '#1f2328'),
    'border-radius:999px', 'animation:minis-enter-spin .8s linear infinite'
  ].join(';');
  el.appendChild(spinner);

  var host = document.querySelector('.df__view');
  if (host) {
    host.appendChild(el);
  } else {
    var mac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
    el.style.position = 'fixed';
    el.style.borderRadius = mac ? '0' : '20px';
    (document.body || document.documentElement).appendChild(el);
  }
  requestAnimationFrame(function () {
    el.style.opacity = '1';
    el.style.backdropFilter = 'blur(14px)';
    el.style.webkitBackdropFilter = 'blur(14px)';
  });
  setTimeout(function () {
    el.style.opacity = '0';
    el.style.backdropFilter = 'blur(0px)';
    el.style.webkitBackdropFilter = 'blur(0px)';
    setTimeout(function () { el.remove(); style.remove(); }, 700);
  }, 8000);
})();"#;

/// 当前实例的地址，引导页据此提供「回到实例」入口。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceSession {
    /// 进入时用的目标地址（远程为归一化后的站点地址；本机为 127.0.0.1 的就绪地址）
    url: String,
    /// "local" | "remote"
    mode: String,
}

/// 壳的当前状态（引导页据此渲染）
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    mode: config::Mode,
    remote_base_url: String,
    /// idle=待选择 / boot=正在启动本机后端 / ready=已跳转本机后端 / remote=已跳转远程 / error=失败
    phase: String,
    detail: String,
    /// 会话是否已失效（登出 / 被 hostid 打回）：引导页据此显示「重新登录」横幅。
    /// 放状态里而不是靠事件推送，是因为带窗口回引导页时页面还没加载，事件会丢。
    session_expired: bool,
    /// 存活的实例会话（Some = 实例窗口还在后台，对应卡片显示「回到实例」）
    instance: Option<InstanceSession>,
}

/// 本地用户：进入本机模式后顶替后端的 local-dev
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalUser {
    name: String,
    /// data:image/...;base64,... 的小图；空 = 用首字母兜底
    avatar: String,
}

/// hostid SSO 用户（登录窗口回传后展示在引导页用户菜单里）
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SsoUserView {
    name: String,
    /// 头像地址（hostid avatarUrl，可能为空 → 前端用首字母兜底）
    avatar: String,
    email: String,
}

/// 引导页用户菜单的全量身份视图：当前选中的身份 + 本地用户 + hostid SSO 用户（未登录为 null）
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Users {
    /// 当前选中的身份："local" | "sso"
    current: String,
    local: LocalUser,
    sso: Option<SsoUserView>,
}

/// 从配置组装用户视图
fn users_snapshot(app: &AppHandle) -> Users {
    let cfg = config::load(app);
    Users {
        current: cfg.current_user,
        local: LocalUser {
            name: cfg.local_user_name,
            avatar: cfg.local_user_avatar,
        },
        sso: if cfg.sso_user_name.is_empty() {
            None
        } else {
            Some(SsoUserView {
                name: cfg.sso_user_name,
                avatar: cfg.sso_user_avatar,
                email: cfg.sso_user_email,
            })
        },
    }
}

/// 推送用户视图给引导页（页面不在引导页时无人接收，无副作用）
fn emit_users(app: &AppHandle) {
    let _ = app.emit(USER_EVENT, users_snapshot(app));
}

/// 壳的进程内状态：本机后端子进程句柄 + 一次性令牌 + 已就绪端口 + 对外状态
pub struct Shell {
    local_backend: Mutex<Option<backend::Instance>>,
    status: Mutex<Status>,
    /// 引导页（壳页面）地址：启动时记下，从实例返回时据此把窗口带回引导页
    launcher_url: Mutex<String>,
    /// 正在执行「带回引导页」：拦截到重复导航（会话失效时页面会反复跳登录）只处理一次
    returning: AtomicBool,
    /// 正在「进入实例」：置真后主窗口下一次页面加载（Started）会铺过渡层，取一次即消。
    /// 只有进入（连接 / 登录）铺；「回到实例」「回引导页」是直接导航，不铺。
    entering: AtomicBool,
}

/// 更新状态并推给引导页（页面不在引导页时无人接收，无副作用）
fn emit_status(app: &AppHandle, phase: &str, detail: &str) {
    let shell = app.state::<Shell>();
    let snapshot = {
        let mut status = shell.status.lock().unwrap();
        status.phase = phase.to_string();
        status.detail = detail.to_string();
        status.clone()
    };
    let _ = app.emit(STATUS_EVENT, snapshot);
}

/// 记下用户这次的选择（引导页下次打开时据此高亮）
fn set_choice(app: &AppHandle, mode: config::Mode, remote_base_url: &str) {
    let shell = app.state::<Shell>();
    let mut status = shell.status.lock().unwrap();
    status.mode = mode;
    status.remote_base_url = remote_base_url.to_string();
}

/// 记下 / 清除存活的实例会话并推一份状态：引导页据此把对应卡片在「连接」与「回到实例」间切换
fn set_instance_session(app: &AppHandle, session: Option<InstanceSession>) {
    let Some(shell) = app.try_state::<Shell>() else {
        return;
    };
    let snapshot = {
        let mut status = shell.status.lock().unwrap();
        status.instance = session;
        status.clone()
    };
    let _ = app.emit(STATUS_EVENT, snapshot);
}

/// 当前存活的实例会话（None = 实例窗口不在后台）
fn current_instance_session(app: &AppHandle) -> Option<InstanceSession> {
    app.try_state::<Shell>()
        .and_then(|shell| shell.status.lock().unwrap().instance.clone())
}

/// macOS 原生叠加标题栏配置：
/// 主窗口启用系统装饰与 `TitleBarStyle::Overlay` 后，挂载空 `NSToolbar`（`Unified` + 无分隔线），
/// 由 AppKit 按系统窗口圆角自动同心定位原生红绿灯，同时保留原生全屏、绿灯悬停菜单、未聚焦灰态、
/// 窗口阴影与边缘缩放。
#[cfg(target_os = "macos")]
mod mac_window {
    use objc2::{msg_send, sel, MainThreadOnly};
    use objc2_app_kit::{NSTitlebarSeparatorStyle, NSToolbar, NSWindow, NSWindowToolbarStyle};
    use objc2_foundation::{ns_string, MainThreadMarker};
    use tauri::WebviewWindow;

    pub fn configure_titlebar(window: &WebviewWindow) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Ok(ptr) = window.ns_window() else {
            return;
        };
        if ptr.is_null() {
            return;
        }
        unsafe {
            let ns_window = &*(ptr as *const NSWindow);
            let toolbar = NSToolbar::initWithIdentifier(
                NSToolbar::alloc(mtm),
                ns_string!("minis-main-toolbar"),
            );
            toolbar.setAllowsUserCustomization(false);
            toolbar.setAutosavesConfiguration(false);
            ns_window.setToolbar(Some(&toolbar));
            let supports_toolbar_style: bool =
                msg_send![ns_window, respondsToSelector: sel!(setToolbarStyle:)];
            if supports_toolbar_style {
                ns_window.setToolbarStyle(NSWindowToolbarStyle::Unified);
            }
            let supports_separator_style: bool =
                msg_send![ns_window, respondsToSelector: sel!(setTitlebarSeparatorStyle:)];
            if supports_separator_style {
                ns_window.setTitlebarSeparatorStyle(NSTitlebarSeparatorStyle::None);
            }
        }
    }
}

/// 引导页和实例页共用的品牌信息。
fn desktop_injection() -> String {
    let brand = serde_json::json!({
        "name": env!("BRAND_NAME"),
        "slug": env!("BRAND_SLUG"),
        "tagline": env!("BRAND_TAGLINE"),
    });
    format!("window.__BRAND__={brand};")
}

/// 等主文档提交后再交付令牌。执行脚本时再次检查源，以防两次导航之间文档已切换。
fn deliver_local_token(app: &AppHandle, webview: &Webview, url: &tauri::Url) {
    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") {
        return;
    }
    let origin = serde_json::json!(url.origin().ascii_serialization());
    let token = serde_json::json!(backend::token_for_port(app, url.port_or_known_default()));
    let _ = webview.eval(format!(
        r#"if (window.top === window && location.protocol === "http:" && location.origin === {origin}) {{
            window.__MINIS_LOCAL_TOKEN__ = {token};
            window.__MINIS_LOCAL_API_READY__ = true;
            window.dispatchEvent(new Event("minis:desktop-api-ready"));
        }}"#
    ));
}

/// 主窗口的主 webview（引导页与实例页都加载在它上面）。
fn main_webview(app: &AppHandle) -> Option<Webview> {
    app.get_webview_window(WINDOW_LABEL)
        .map(|window| window.as_ref().clone())
}

/// 让主 webview 跳到某个地址（引导页 ↔ 实例页都是它上面的 document）；返回是否发起了导航
fn navigate(app: &AppHandle, url: &str) -> bool {
    let Some(webview) = main_webview(app) else {
        return false;
    };
    match url.parse::<tauri::Url>() {
        Ok(parsed) => match webview.navigate(parsed) {
            Ok(()) => true,
            Err(err) => {
                emit_status(app, "error", &format!("打开 {url} 失败：{err}"));
                false
            }
        },
        Err(err) => {
            emit_status(app, "error", &format!("地址无效（{url}）：{err}"));
            false
        }
    }
}

/// 记下引导页（壳页面）地址：主窗口第一次真正的页面加载就是引导页（见 setup 的窗口创建），
/// 从 on_page_load 的 payload 里取——比创建后立刻 `window.url()` 可靠（那会儿 webview 还没
/// 提交 URL，取不到就会让「从实例返回」无处可去）。只记第一次，之后加载的就可能是实例页了。
fn remember_launcher_if_first(app: &AppHandle, url: &tauri::Url) {
    // 只认真正的页面地址：about:blank 这类空白文档（部分平台会先来一发）不算
    if !matches!(url.scheme(), "http" | "https" | "tauri") {
        return;
    }
    let shell = app.state::<Shell>();
    let mut slot = shell.launcher_url.lock().unwrap();
    if slot.is_empty() {
        *slot = url.to_string();
    }
}

/// 把窗口带回引导页；返回是否发起了导航
fn navigate_launcher(app: &AppHandle) -> bool {
    let url = app.state::<Shell>().launcher_url.lock().unwrap().clone();
    if url.is_empty() {
        eprintln!("[minis-desktop] 未知引导页地址，无法把窗口带出后端站点");
        return false;
    }
    navigate(app, &url)
}

/// 主窗口的首页导航由壳处理，远程认证跳转交给 HostID 模块。
fn intercept_navigation(app: &AppHandle, nav: &tauri::Url) -> bool {
    if nav.path() == HOME_PATH {
        let handle = app.clone();
        std::thread::spawn(move || open_launcher_home(&handle));
        return false;
    }
    hostid::intercept_navigation(app, nav)
}

/// 实例页的首页入口：把实例当前地址（含 #hash 路由）记进壳状态，再直接导航回引导页。
///
/// <p>这次切换不铺过渡层（只有首次进入 / 登出才铺），引导页一加载就是清晰的。记下的地址
/// 让引导页的对应卡片变成「回到实例」，点它即回到离开时的那个页面。
fn open_launcher_home(app: &AppHandle) {
    // 读实例页当前地址：别丢 #hash 路由（如 #/graph、#/articles/xxx）；
    // 哨兵地址本身不算（万一拦截时机有偏差，别把哨兵当成实例地址记下来）
    let current = main_webview(app)
        .and_then(|webview| webview.url().ok())
        .filter(|url| url.path() != HOME_PATH && url.path() != hostid::LOGOUT_PATH)
        .map(|url| url.to_string());

    let shell = app.state::<Shell>();
    let snapshot = {
        let mut status = shell.status.lock().unwrap();
        let mode = match status.mode {
            config::Mode::Local => "local",
            config::Mode::Remote => "remote",
        }
        .to_string();
        status.instance = current.map(|url| InstanceSession { url, mode });
        status.phase = "idle".to_string();
        status.detail = String::new();
        status.clone()
    };
    let _ = app.emit(STATUS_EVENT, snapshot);
    navigate_launcher(app);
}

/// 引导页读取当前状态
#[tauri::command]
fn desktop_state(shell: tauri::State<'_, Shell>) -> Status {
    shell.status.lock().unwrap().clone()
}

/// 读取用户菜单全量身份（当前用户 + 本地用户 + hostid SSO 用户）
#[tauri::command]
fn desktop_users(app: AppHandle) -> Users {
    users_snapshot(&app)
}

/// 切换当前用户（"local" | "sso"）；未登录 hostid 时不允许选 sso
#[tauri::command]
fn desktop_switch_user(app: AppHandle, kind: String) -> Result<Users, String> {
    config::update(&app, |cfg| {
        match kind.as_str() {
            "local" => {}
            "sso" if !cfg.sso_user_name.is_empty() => {}
            "sso" => return Err("尚未登录 HostID".to_string()),
            other => return Err(format!("未知的用户类型：{other}")),
        }
        cfg.current_user = kind;
        Ok(())
    })?;
    let snapshot = users_snapshot(&app);
    let _ = app.emit(USER_EVENT, snapshot.clone());
    Ok(snapshot)
}

/// 保存本地用户（引导页用户菜单提交）；下次启动本机后端时随环境变量注入
#[tauri::command]
fn desktop_save_local_user(app: AppHandle, name: String, avatar: String) -> Result<(), String> {
    config::update(&app, |cfg| {
        cfg.local_user_name = name.trim().to_string();
        cfg.local_user_avatar = avatar;
        Ok(())
    })?;
    emit_users(&app);
    Ok(())
}

/// 引导页确认「返回动画已放完」：把相位从 returning 收回 idle。
/// 否则状态行会一直停在「正在返回…」（相位是壳状态，页面自己改不了）。
#[tauri::command]
fn desktop_return_done(app: AppHandle) {
    let shell = app.state::<Shell>();
    let snapshot = {
        let mut status = shell.status.lock().unwrap();
        if status.phase != "returning" {
            return;
        }
        status.phase = "idle".to_string();
        status.detail.clear();
        status.clone()
    };
    let _ = app.emit(STATUS_EVENT, snapshot);
}

/// 选本机模式：拉起后端（或复用本次会话已起来的那个），就绪后进入实例窗口
#[tauri::command]
fn desktop_choose_local(app: AppHandle) -> Result<(), String> {
    hostid::ensure_idle(&app)?;
    config::update(&app, |cfg| {
        cfg.mode = config::Mode::Local;
        Ok(())
    })?;
    set_choice(&app, config::Mode::Local, "");
    hostid::set_session_expired(&app, false);

    if let Some(port) = backend::known_port(&app) {
        emit_status(&app, "ready", &format!("本地服务器已就绪（端口 {port}）"));
        enter_instance(&app, &format!("http://127.0.0.1:{port}/"), "local");
        return Ok(());
    }
    backend::start(&app)
}

/// 回到离开时记下的地址（含 #hash）。远程实例先校验会话。
/// 会话与业务数据都在后端、前端状态都在 localStorage，重新渲染后即回到离开时的页面。
#[tauri::command]
fn desktop_show_instance(app: AppHandle) -> Result<(), String> {
    let Some(session) = current_instance_session(&app) else {
        return Ok(());
    };
    if session.mode == "remote" {
        return hostid::resume_remote(app, session.url);
    }
    std::thread::spawn(move || {
        if !navigate(&app, &session.url) {
            set_instance_session(&app, None);
        }
    });
    Ok(())
}

/// 进入实例的统一入口：先铺过渡相位（引导页主视图渐入高斯模糊），稍后在模糊层下导航过去。
///
/// 本机启动完成、远程连接通过认证时使用这个入口。
fn enter_instance(app: &AppHandle, url: &str, mode: &str) {
    // 进入时先按目标地址记一份会话：离开实例前（首页入口）会覆盖成带 #hash 的精确地址
    set_instance_session(
        app,
        Some(InstanceSession {
            url: url.to_string(),
            mode: mode.to_string(),
        }),
    );
    emit_status(app, "entering", "正在进入实例…");
    let handle = app.clone();
    let url = url.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1600)); // 渐入 0.6s + 停留
                                                         // 导航藏在模糊层下：置标记后立刻导航，实例页文档创建时会铺上同款过渡层
        handle
            .state::<Shell>()
            .entering
            .store(true, Ordering::SeqCst);
        if !navigate(&handle, &url) {
            // 导航没发起：撤掉标记，别把引导页困在模糊层里
            handle
                .state::<Shell>()
                .entering
                .store(false, Ordering::SeqCst);
            set_instance_session(&handle, None);
        }
    });
}

/// 往主窗口当前页面弹一条自绘通知（注入一个置顶胶囊；页面跳走后自然消失）。
///
/// <p>主窗口可能在壳页面（tauri 源）也可能在远程实例上，两边的样式/框架都不同，
/// 所以这里自带最小样式，不依赖任何一方的组件。
fn notify_main(app: &AppHandle, text: &str) {
    let Some(webview) = main_webview(app) else {
        return;
    };
    let text_lit = serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string());
    let js = format!(
        r#"(function () {{
  var id = '__minis_desktop_toast__';
  var el = document.getElementById(id);
  if (!el) {{
    el = document.createElement('div');
    el.id = id;
    el.style.cssText = [
      'position:fixed', 'left:50%', 'top:20px', 'transform:translateX(-50%)',
      'z-index:2147483647', 'max-width:70vw',
      'padding:9px 16px', 'border-radius:8px',
      'border:1px solid rgba(255,255,255,.12)',
      'background:rgba(25,28,30,.94)', 'color:#e6edf3',
      'font:500 13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
      'box-shadow:0 8px 24px rgba(0,0,0,.22)', 'pointer-events:none',
      'opacity:0', 'transition:opacity .2s ease',
      'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis'
    ].join(';');
    (document.body || document.documentElement).appendChild(el);
  }}
  el.textContent = {text};
  requestAnimationFrame(function () {{ el.style.opacity = '1'; }});
  if (el.__minisTimer) clearTimeout(el.__minisTimer);
  el.__minisTimer = setTimeout(function () {{ el.style.opacity = '0'; }}, 8000);
}})();"#,
        text = text_lit,
    );
    let _ = webview.eval(&js);
}

/// 在模糊过渡中返回引导页，清除实例入口。
fn return_to_launcher(app: &AppHandle, notice: Option<&str>) {
    if app.state::<Shell>().returning.swap(true, Ordering::SeqCst) {
        return;
    }

    // 当前页（实例页）先渐入模糊层（清晰 → 模糊）
    if let Some(webview) = main_webview(app) {
        let _ = webview.eval(EXIT_VEIL_JS);
    }
    if let Some(text) = notice {
        notify_main(app, text);
    }
    std::thread::sleep(Duration::from_millis(1600)); // 渐入 0.6s + 停留

    // 相位先落到 returning、并清掉实例会话，再导航：引导页一加载就是模糊态，随后自己渐出；
    // 会话没了，卡片回到「连接 / 启动」
    let shell = app.state::<Shell>();
    shell.entering.store(false, Ordering::SeqCst);
    let snapshot = {
        let mut status = shell.status.lock().unwrap();
        status.instance = None;
        status.phase = "returning".to_string();
        status.detail = String::new();
        status.clone()
    };
    let _ = app.emit(STATUS_EVENT, snapshot);
    navigate_launcher(app);
    app.state::<Shell>()
        .returning
        .store(false, Ordering::SeqCst);
}

/* ------------------------------------------------------------------ *
 * 窗口控制
 *
 * macOS 启用原生系统装饰（`.decorations(true)` + `TitleBarStyle::Overlay` + `hidden_title(true)`），
 * 左上角红绿灯、窗口圆角、阴影与边缘缩放均由 AppKit 原生提供；页面仅保留 `data-tauri-drag-region`
 * 拖拽区并避开红绿灯区域。
 *
 * 非 macOS（Windows / Linux）去掉系统装饰（`.decorations(false)`），由引导页（tauri 源）与
 * 实例页（HTTP 源）页面自绘标题栏，统一经 Tauri 核心 window 插件的命令回落系统行为：
 *
 *   拖拽   → data-tauri-drag-region 属性（框架内置脚本，含双击最大化）
 *   最小化 → plugin:window|minimize
 *   最大化 → plugin:window|toggle_maximize（图标状态读 is_maximized）
 *   关闭   → plugin:window|close
 *   缩放   → plugin:window|start_resize_dragging（窗缘热区，页面自绘）
 *
 * 这些命令由 capabilities/default.json 授权（windows 列 main），其中 remote 列出 HTTP 源，
 * 否则实例页没有 IPC，标题栏与主题同步会失效。
 * ------------------------------------------------------------------ */

fn main() {
    if let Some(code) = computer::run_cli() {
        std::process::exit(code);
    }
    tauri::Builder::default()
        // 单实例必须最先注册：本机后端含 SQLite(WAL) 与进程内心跳/圆桌状态，不能双开
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // 单窗口：唤醒即显示并聚焦主窗口（里面当前显示的是引导页或实例页）。
            if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            economy_capture::economy_windows,
            economy_capture::economy_capture_window,
            desktop_state,
            desktop_users,
            desktop_switch_user,
            desktop_save_local_user,
            hostid::desktop_hostid_base,
            hostid::desktop_relogin_hostid,
            desktop_return_done,
            hostid::desktop_dismiss_session_notice,
            hostid::desktop_logout_hostid,
            desktop_choose_local,
            hostid::desktop_choose_remote,
            desktop_show_instance,
            hostid::desktop_login_hostid
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let cfg = config::load(&handle);

            app.manage(hostid::State::default());
            app.manage(Shell {
                local_backend: Mutex::new(None),
                status: Mutex::new(Status {
                    mode: cfg.mode,
                    remote_base_url: cfg.remote_base_url.clone(),
                    phase: "idle".to_string(),
                    detail: String::new(),
                    session_expired: false,
                    instance: None,
                }),
                launcher_url: Mutex::new(String::new()),
                returning: AtomicBool::new(false),
                entering: AtomicBool::new(false),
            });

            // 一律先落在引导页：本机 / 远程由用户当场选，壳不自动连任何一个。
            // 引导页与实例页共用这一个 webview，靠导航互换（见文件头说明）。
            #[allow(unused_mut)]
            let mut builder =
                WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::App("index.html".into()))
                    .title(env!("BRAND_NAME"))
                    .inner_size(1280.0, 720.0)
                    .min_inner_size(1280.0, 720.0)
                    // macOS 使用原生系统装饰 + 透明叠加标题栏（调用原生红绿灯、圆角、阴影与边缘缩放）；
                    // 其余平台保持无边框透明窗口，由页面自绘标题栏 / 窗口按钮 / 边缘缩放热区。
                    .decorations(cfg!(target_os = "macos"))
                    .transparent(!cfg!(target_os = "macos"))
                    // 空的效果配置：先把调用点占住，将来开亚克力往列表里加一项即可。
                    // effect 列表为空时，系统侧 apply_effects 找不到可应用的条项，直接返回，
                    // 所以现在这个写法是纯 no-op。加效果时记得把 Effect / EffectState / Color
                    // 补回上面的 use。
                    .effects(EffectsBuilder::new().build())
                    // Windows 上无边框窗口仍留着 WS_THICKFRAME，DWM 会按「窗口矩形」而不是页面的
                    // 圆角外壳去投影子（实测窗口矩形比页面视口整整大一圈），圆角外会多出方角影子，
                    // 因此在 Windows 上继续关闭系统阴影；
                    // macOS 使用原生 Titled 窗口，由 AppKit / WindowServer 直接绘制原生窗口阴影。
                    .shadow(cfg!(target_os = "macos"))
                    // 每次启动都居中；再兜一下溢出——1600×900 在小屏上放不下时，
                    // 会被夹到「屏幕 - 任务栏」的尺寸，免得居中之后反而被裁掉一块
                    .center()
                    .prevent_overflow()
                    .initialization_script(desktop_injection())
                    // 壳接管返回首页及远程实例上的认证导航。
                    .on_navigation({
                        let nav_handle = handle.clone();
                        move |nav| intercept_navigation(&nav_handle, nav)
                    })
                    // 主窗口每次页面加载：① 第一次（引导页）把它的地址记下，从实例返回时据此导航回来；
                    // ② 若正在「进入实例」，在文档创建时就铺过渡层，由实例页接着做「模糊 → 清晰」的渐出。
                    .on_page_load({
                        let page_handle = handle.clone();
                        move |window, payload| {
                            if let PageLoadEvent::Started = payload.event() {
                                deliver_local_token(&page_handle, window.as_ref(), payload.url());
                                remember_launcher_if_first(&page_handle, payload.url());
                                if page_handle
                                    .state::<Shell>()
                                    .entering
                                    .swap(false, Ordering::SeqCst)
                                {
                                    let _ = window.eval(ENTER_VEIL_JS);
                                }
                            }
                        }
                    });
            #[cfg(target_os = "macos")]
            {
                builder = builder
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true);
            }
            let main_window = builder.build()?;
            #[cfg(target_os = "macos")]
            mac_window::configure_titlebar(&main_window);
            #[cfg(not(target_os = "macos"))]
            let _ = main_window;
            backend::log_probe(&handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("minis desktop 启动失败")
        .run(|app, event| match event {
            RunEvent::Exit => backend::stop(app),
            // 主窗口一关就把附属窗口一起收掉：它们不是独立窗口，主窗口没了还留在屏幕上
            // 会变成孤儿，而且进程会因为有窗口而赖着不退（本机后端也就一直跑着）。
            RunEvent::WindowEvent { label, event, .. } if label == WINDOW_LABEL => {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    hostid::close_window(app);
                }
            }
            _ => {}
        });
}

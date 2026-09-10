# Quantum Physics Lab Windows 打包规范

## 1. 适用范围

本规范适用于发布 `quantum-physics-lab` 的 Windows 桌面版、NSIS 安装包和安装后自动验收。

用户提供的启动页截图仅作为界面问题的验收参考，不属于构建脚本、安装路径或运行时行为指令。

## 2. 发布物形态

最终安装目录必须只包含一个主程序：

```text
quantum-physics-lab.exe
```

禁止在安装目录中放置或依赖以下文件：

- `WebView2Loader.dll`
- `quantum-physics-lab-core.exe`
- 自解包启动器
- 运行时 DLL 解压目录
- 固定开发机路径下的资源

`quantum-physics-lab.exe` 必须是 Tauri 原生程序本身，并通过 MSVC 目标构建。`WebView2Loader.dll` 必须通过 MSVC 静态库链接进主程序，而不是运行时释放、复制或旁路加载。

## 3. 编译工具链

唯一允许的 Windows 发布目标：

```text
x86_64-pc-windows-msvc
```

发布构建必须满足：

- Rust target 为 `x86_64-pc-windows-msvc`；
- `CARGO_CFG_TARGET_ENV` 为 `msvc`；
- 不得使用 GNU/MinGW 目标生成发布物；
- Tauri、Rust 和前端资源必须由同一次发布构建产生；
- 产物命名固定为 `quantum-physics-lab.exe`。

标准命令：

```powershell
npm run build:tauri
npx tauri bundle --target x86_64-pc-windows-msvc -b nsis
```

## 4. WebView2 依赖规则

### 4.1 Loader

发布 EXE 不得直接依赖外部 `WebView2Loader.dll`。MSVC 构建应使用 `WebView2LoaderStatic.lib` 的静态链接路径。

验收要求：

- 安装目录找不到 `WebView2Loader.dll`；
- 发布 EXE 的 PE 导入表找不到 `WebView2Loader.dll`；
- 程序启动后不创建 DLL 解包缓存；
- 程序不得通过 `%LOCALAPPDATA%` 运行目录加载核心 EXE 或 Loader DLL。

### 4.2 WebView2 Runtime

静态链接 Loader 不等于内置 WebView2 Runtime。目标机器没有 WebView2 Runtime 时，仍按现有安装策略提示或安装 Runtime；不得把 Runtime 的安装文件误当作应用 DLL 打进安装目录。

## 5. 运行时约束

发布程序禁止使用以下方案：

- 启动时释放核心 EXE；
- 启动时释放 `WebView2Loader.dll`；
- 创建“运行缓存”“解包缓存”或版本哈希运行目录；
- 通过临时目录替代静态链接；
- 仅在开发模式可用、生产模式失效的固定机器路径。

允许使用的目录仅限应用自身正常数据目录，例如配置、日志和用户数据；这些目录不得用于存放或加载发布程序的 EXE/DLL。

## 6. NSIS 安装包

NSIS 必须：

- 只复制 `quantum-physics-lab.exe`；
- 快捷方式指向 `quantum-physics-lab.exe`；
- 卸载检查针对主程序和应用安装目录；
- 不复制、不删除、不注册 `WebView2Loader.dll`；
- 不包含固定开发机路径，例如 `D:\wuli` 或 `E:\桌面\图片素材`；
- 使用项目内可复现的安装页背景资源；
- 安装页背景显示完整图片，不叠加多余图片元素；
- 进度显示保持极简，只显示必要的百分比和状态文本。

安装完成后的目录验收：

```text
安装目录\quantum-physics-lab.exe       必须存在
安装目录\WebView2Loader.dll            必须不存在
安装目录\quantum-physics-lab-core.exe  必须不存在
```

## 7. 启动页与启动流程

启动页必须在主程序完成 WebView 初始化后进入主界面，不得把耗时的 GPU 预热或完整实验台构造放在启动关键路径中。

要求：

- 启动阶段使用轻量场景或代理对象；
- 完整实验台按需加载；
- GPU 预热不得阻塞 WebView 创建；
- 不得使用固定的“26%”作为永不结束的等待状态；
- 生产构建和 `npm run dev` 必须执行同一套启动状态机。

## 8. 自动化验收

每次发布必须执行以下检查：

1. 构建 MSVC Tauri 主程序。
2. 构建 NSIS 安装包。
3. 检查 PE 导入表，确认没有外部 `WebView2Loader.dll` 依赖。
4. 解包或安装到干净目录，确认目录只有主 EXE。
5. 启动主 EXE，等待 WebView 创建和主界面出现。
6. 确认启动进度不会停在 26%。
7. 确认 `%LOCALAPPDATA%` 下没有运行缓存、核心 EXE 或 Loader DLL。
8. 检查快捷方式目标和卸载入口。
9. 卸载后确认安装目录被清理。
10. 执行全部 Node 测试。

建议命令：

```powershell
npm test
npm run build:tauri
npx tauri bundle --target x86_64-pc-windows-msvc -b nsis
```

## 9. 发布前禁止项

以下任一项出现时不得发布：

- 构建目标不是 MSVC；
- 安装目录出现 `WebView2Loader.dll`；
- EXE 依赖外部 `WebView2Loader.dll`；
- 运行时生成核心 EXE 或 DLL 缓存；
- NSIS 引用了开发机绝对路径；
- 安装后仍卡在 26%；
- 启动页不是完整背景图；
- 自动测试失败或未执行。

## 10. 变更记录要求

任何涉及 Tauri、WebView2、NSIS、启动页或启动流程的修改，都必须同步更新：

- 构建脚本；
- `test/singleFilePackaging.test.js` 或对应打包测试；
- 本规范中受影响的验收条目；
- 发布说明中的安装目录和运行时行为。


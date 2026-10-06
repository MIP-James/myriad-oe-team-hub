import os
import sys
import runpy
import subprocess
import tkinter as tk


APP_TITLE = "VeRO 자동화 통합 런처"

TOOL_MAPPING = {
    "auction_vero": "Auction_VeRO_Macro.py",
    "gmarket_vero": "Gmarket_VeRO_Macro.py",
}


def resource_base_dir() -> str:
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def center_window(win, width=None, height=None):
    win.update_idletasks()
    if width is None:
        width = win.winfo_width()
    if height is None:
        height = win.winfo_height()
    sw = win.winfo_screenwidth()
    sh = win.winfo_screenheight()
    x = int((sw / 2) - (width / 2))
    y = int((sh / 2) - (height / 2))
    if width and height:
        win.geometry(f"{width}x{height}+{x}+{y}")
    else:
        win.geometry(f"+{x}+{y}")


def run_tool_in_current_process(tool_key: str):
    script_name = TOOL_MAPPING.get(tool_key)
    if not script_name:
        raise RuntimeError(f"알 수 없는 tool_key: {tool_key}")
    script_path = os.path.join(resource_base_dir(), script_name)
    if not os.path.exists(script_path):
        raise FileNotFoundError(f"실행 파일을 찾지 못했습니다: {script_path}")
    old_argv = sys.argv[:]
    old_cwd = os.getcwd()
    try:
        sys.argv = [script_path]
        os.chdir(os.path.dirname(script_path))
        runpy.run_path(script_path, run_name="__main__")
    finally:
        sys.argv = old_argv
        os.chdir(old_cwd)


def run_tool(tool_key: str):
    if getattr(sys, "frozen", False):
        subprocess.Popen([sys.executable, "--tool", tool_key], cwd=os.path.dirname(sys.executable))
    else:
        run_tool_in_current_process(tool_key)


def run_auction():
    run_tool("auction_vero")


def run_gmarket():
    run_tool("gmarket_vero")


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--tool":
        run_tool_in_current_process(sys.argv[2])
        raise SystemExit(0)

    root = tk.Tk()
    root.title(APP_TITLE)
    root.geometry("400x200")
    root.resizable(False, False)
    center_window(root, 400, 200)

    tk.Label(
        root,
        text="실행할 자동화 프로그램을 선택하세요.",
        font=("맑은 고딕", 13)
    ).pack(pady=20)

    tk.Button(
        root,
        text="Auction VeRO 매크로 실행",
        height=2,
        width=25,
        command=run_auction
    ).pack(pady=10)

    tk.Button(
        root,
        text="Gmarket VeRO 매크로 실행",
        height=2,
        width=25,
        command=run_gmarket
    ).pack(pady=5)

    root.mainloop()

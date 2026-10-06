# -*- coding: utf-8 -*-
import os
import sys
import runpy
import shutil
import subprocess
import tkinter as tk
from tkinter import ttk, messagebox, filedialog
from tkinter import font as tkfont

APP_TITLE = "MYRIAD Online Enforcement Tools"
APP_SUB = "Base64 Embedded · Self-Spawn Launcher"
SPLASH_IMAGE = "MY_vert-Photoroom.png"
EXCEL_TEMPLATE = "2025_수동입력_template_업로드용.xlsm"

TOOL_MAPPING = {
    "naver": "NaverAutomationLauncher.py",
    "vero": "VeRO_Automation_Launcher.py",
    "crawler": "Image_Crawler.py",
    "uploader": "Image_Uploader.py",
    "auction_vero": "Auction_VeRO_Macro.py",
    "gmarket_vero": "Gmarket_VeRO_Macro.py",
}


def resource_base_dir() -> str:
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def launcher_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def resource_path(name: str) -> str:
    return os.path.join(resource_base_dir(), name)


def center_window(win, width=None, height=None):
    win.update_idletasks()
    width = width or max(win.winfo_width(), win.winfo_reqwidth())
    height = height or max(win.winfo_height(), win.winfo_reqheight())
    sw = win.winfo_screenwidth()
    sh = win.winfo_screenheight()
    x = int((sw - width) / 2)
    y = int((sh - height) / 2)
    win.geometry(f"{width}x{height}+{x}+{y}")


def hide_internal_folder():
    if not getattr(sys, "frozen", False):
        return
    target = os.path.join(launcher_dir(), "_internal")
    if not os.path.exists(target) or not sys.platform.startswith("win"):
        return
    try:
        import ctypes
        FILE_ATTRIBUTE_HIDDEN = 0x02
        ctypes.windll.kernel32.SetFileAttributesW(target, FILE_ATTRIBUTE_HIDDEN)
    except Exception:
        pass


def _call_with_centered_parent(func, *args, **kwargs):
    parent = kwargs.get("parent")
    temp_parent = None
    try:
        if parent is None:
            temp_parent = tk.Tk()
            temp_parent.withdraw()
            center_window(temp_parent, 1, 1)
            kwargs["parent"] = temp_parent
        return func(*args, **kwargs)
    finally:
        if temp_parent is not None:
            try:
                temp_parent.destroy()
            except Exception:
                pass


def patch_center_dialogs_only():
    from tkinter import messagebox as _messagebox
    from tkinter import filedialog as _filedialog

    _messagebox.showinfo = (lambda orig: (lambda *a, **k: _call_with_centered_parent(orig, *a, **k)))(_messagebox.showinfo)
    _messagebox.showwarning = (lambda orig: (lambda *a, **k: _call_with_centered_parent(orig, *a, **k)))(_messagebox.showwarning)
    _messagebox.showerror = (lambda orig: (lambda *a, **k: _call_with_centered_parent(orig, *a, **k)))(_messagebox.showerror)
    _messagebox.askyesno = (lambda orig: (lambda *a, **k: _call_with_centered_parent(orig, *a, **k)))(_messagebox.askyesno)
    _messagebox.askokcancel = (lambda orig: (lambda *a, **k: _call_with_centered_parent(orig, *a, **k)))(_messagebox.askokcancel)

    _filedialog.askopenfilename = (lambda orig: (lambda *a, **k: _call_with_centered_parent(orig, *a, **k)))(_filedialog.askopenfilename)
    _filedialog.asksaveasfilename = (lambda orig: (lambda *a, **k: _call_with_centered_parent(orig, *a, **k)))(_filedialog.asksaveasfilename)
    _filedialog.askdirectory = (lambda orig: (lambda *a, **k: _call_with_centered_parent(orig, *a, **k)))(_filedialog.askdirectory)


def patch_center_new_windows_temporarily():
    """
    Tk/Toplevel 클래스를 바꾸지 않고 __init__ 메서드만 임시 패치.
    하위 스크립트에서 새 루트/팝업이 기본적으로 중앙에 뜨게 함.
    """
    orig_tk_init = tk.Tk.__init__
    orig_toplevel_init = tk.Toplevel.__init__

    def patched_tk_init(self, *args, **kwargs):
        orig_tk_init(self, *args, **kwargs)
        try:
            self.after(0, lambda win=self: center_window(win))
        except Exception:
            pass

    def patched_toplevel_init(self, *args, **kwargs):
        orig_toplevel_init(self, *args, **kwargs)
        try:
            self.after(0, lambda win=self: center_window(win))
        except Exception:
            pass

    tk.Tk.__init__ = patched_tk_init
    tk.Toplevel.__init__ = patched_toplevel_init

    def restore():
        tk.Tk.__init__ = orig_tk_init
        tk.Toplevel.__init__ = orig_toplevel_init

    return restore


def run_tool_in_current_process(tool_key: str):
    script_name = TOOL_MAPPING.get(tool_key)
    if not script_name:
        raise RuntimeError(f"알 수 없는 tool_key: {tool_key}")
    script_path = resource_path(script_name)
    if not os.path.exists(script_path):
        raise FileNotFoundError(f"실행 파일을 찾지 못했습니다: {script_path}")

    old_argv = sys.argv[:]
    old_cwd = os.getcwd()
    restore_center_patch = patch_center_new_windows_temporarily()
    try:
        sys.argv = [script_path]
        os.chdir(os.path.dirname(script_path))
        runpy.run_path(script_path, run_name="__main__")
    finally:
        restore_center_patch()
        sys.argv = old_argv
        os.chdir(old_cwd)


def self_spawn_run(tool_key: str):
    if getattr(sys, "frozen", False):
        subprocess.Popen([sys.executable, "--tool", tool_key], cwd=launcher_dir())
    else:
        run_tool_in_current_process(tool_key)


def download_excel_template():
    src = resource_path(EXCEL_TEMPLATE)
    if not os.path.exists(src):
        messagebox.showerror("오류", f"엑셀 템플릿을 찾지 못했습니다.\n{src}")
        return

    target = filedialog.asksaveasfilename(
        initialdir=launcher_dir(),
        initialfile=EXCEL_TEMPLATE,
        defaultextension=".xlsm",
        filetypes=[("Excel Macro-Enabled Workbook", "*.xlsm"), ("All Files", "*.*")],
        title="엑셀 템플릿 저장 위치 선택",
    )
    if not target:
        return

    try:
        shutil.copyfile(src, target)
        messagebox.showinfo("완료", f"저장됨:\n{target}")
    except Exception as e:
        messagebox.showerror("저장 오류", str(e))


def create_image_folder():
    folder = os.path.join(launcher_dir(), "상세 이미지")
    try:
        os.makedirs(folder, exist_ok=True)
        if sys.platform.startswith("win"):
            os.startfile(folder)
        elif sys.platform == "darwin":
            subprocess.call(["open", folder])
        else:
            subprocess.call(["xdg-open", folder])
    except Exception as e:
        messagebox.showerror("오류", f"폴더 생성 실패:\n{e}")


def show_splash(duration_ms=1400):
    splash = tk.Toplevel()
    splash.overrideredirect(True)
    splash.attributes("-topmost", True)

    wrap = tk.Frame(splash, bg="white", bd=1, relief="solid")
    wrap.pack(fill="both", expand=True)

    img_label = tk.Label(wrap, bg="white")
    img_label.pack(padx=20, pady=(20, 10))

    title = tk.Label(
        wrap,
        text="MYRIAD Online Enforcement Tools",
        font=("Malgun Gothic", 12, "bold"),
        bg="white",
        fg="#111111"
    )
    title.pack(padx=16)

    sub = tk.Label(
        wrap,
        text="Loading launcher...",
        font=("Malgun Gothic", 9),
        bg="white",
        fg="#666666"
    )
    sub.pack(padx=16, pady=(4, 16))

    img_path = resource_path(SPLASH_IMAGE)
    photo = None
    try:
        from PIL import Image, ImageTk
        if os.path.exists(img_path):
            im = Image.open(img_path).convert("RGBA")
            im.thumbnail((180, 180))
            photo = ImageTk.PhotoImage(im, master=splash)
    except Exception:
        try:
            if os.path.exists(img_path):
                photo = tk.PhotoImage(file=img_path, master=splash)
        except Exception:
            photo = None

    if photo is not None:
        img_label.configure(image=photo)
        img_label.image = photo
    else:
        img_label.configure(text="MYRIAD", font=("Malgun Gothic", 18, "bold"))

    splash.update_idletasks()
    center_window(splash)
    splash.after(duration_ms, splash.destroy)
    splash.wait_window()


def build_gui():
    root = tk.Tk()
    root.title(APP_TITLE)
    root.geometry("760x590")
    root.minsize(760, 590)

    try:
        title_font = tkfont.Font(root, family="Malgun Gothic", size=20, weight="bold")
        sub_font = tkfont.Font(root, family="Malgun Gothic", size=10)
        card_title_font = tkfont.Font(root, family="Malgun Gothic", size=18, weight="bold")
        hint_font = tkfont.Font(root, family="Malgun Gothic", size=7, weight="bold")
    except Exception:
        title_font = tkfont.Font(root, size=20, weight="bold")
        sub_font = tkfont.Font(root, size=10)
        card_title_font = tkfont.Font(root, size=18, weight="bold")
        hint_font = tkfont.Font(root, size=7, weight="bold")

    header = ttk.Frame(root, padding=(18, 12, 18, 6))
    header.pack(fill="x")

    title_row = ttk.Frame(header)
    title_row.pack(anchor="center")

    logo = None
    try:
        from PIL import Image, ImageTk
        img_path = resource_path(SPLASH_IMAGE)
        if os.path.exists(img_path):
            im = Image.open(img_path).convert("RGBA")
            im.thumbnail((42, 42))
            logo = ImageTk.PhotoImage(im, master=root)
    except Exception:
        pass

    if logo is not None:
        logo_label = tk.Label(title_row, image=logo)
        logo_label.image = logo
        logo_label.pack(side="left", padx=(0, 10))

    ttk.Label(title_row, text=APP_TITLE, font=title_font).pack(side="left")
    ttk.Label(header, text=APP_SUB, font=sub_font, foreground="#666666").pack(anchor="center", pady=(2, 0))

    toolbar = ttk.Frame(root, padding=(18, 6))
    toolbar.pack(fill="x")
    inner = ttk.Frame(toolbar)
    inner.pack(anchor="center")
    ttk.Button(inner, text="BPM 수동 입력 업로드용 Template", command=download_excel_template).grid(row=0, column=0, padx=(0, 8))
    ttk.Button(inner, text="이미지 저장 폴더 생성", command=create_image_folder).grid(row=0, column=1, padx=(8, 0))

    main = ttk.Frame(root, padding=(22, 8))
    main.pack(fill="both", expand=False)

    ORANGE = "#FFB300"

    def add_card(parent, title, key, shortcut):
        card = tk.Frame(parent, bg=ORANGE, height=90, cursor="hand2",
                        bd=1, relief="solid", highlightbackground="black", highlightthickness=1)
        card.pack(fill="x", expand=False, pady=6)
        card.pack_propagate(False)

        lbl = tk.Label(card, text=title, font=card_title_font, bg=ORANGE, fg="#111111")
        lbl.pack(expand=True)

        badge = tk.Frame(card, bg="#ffffff", highlightthickness=1, highlightbackground="#bbbbbb")
        badge.place(relx=1.0, y=6, x=-6, anchor="ne")
        tk.Label(badge, text=shortcut, font=hint_font, bg="#ffffff", fg="#333333", padx=5, pady=2).pack()
        badge.lift()

        def _run(_=None):
            self_spawn_run(key)

        for w in (card, lbl):
            w.bind("<Button-1>", _run)
            w.configure(cursor="hand2")

        def _hover_in(_):
            card.configure(bg="#E6A200")
            lbl.configure(bg="#E6A200")

        def _hover_out(_):
            card.configure(bg=ORANGE)
            lbl.configure(bg=ORANGE)

        card.bind("<Enter>", _hover_in)
        card.bind("<Leave>", _hover_out)
        lbl.bind("<Enter>", _hover_in)
        lbl.bind("<Leave>", _hover_out)

    add_card(main, "Naver Automation Launcher", "naver", "Alt+N")
    add_card(main, "VeRO Automation Launcher", "vero", "Alt+V")
    add_card(main, "Other Platform Image Crawler", "crawler", "Alt+C")
    add_card(main, "Image Uploader", "uploader", "Alt+U")

    root.bind_all("<Alt-n>", lambda e: self_spawn_run("naver"))
    root.bind_all("<Alt-v>", lambda e: self_spawn_run("vero"))
    root.bind_all("<Alt-c>", lambda e: self_spawn_run("crawler"))
    root.bind_all("<Alt-u>", lambda e: self_spawn_run("uploader"))

    center_window(root, 760, 590)
    root.deiconify()
    root.mainloop()


if __name__ == "__main__":
    patch_center_dialogs_only()
    hide_internal_folder()

    if len(sys.argv) >= 3 and sys.argv[1] == "--tool":
        run_tool_in_current_process(sys.argv[2])
        raise SystemExit(0)

    _bootstrap = tk.Tk()
    _bootstrap.withdraw()
    show_splash()
    _bootstrap.destroy()
    build_gui()

import tkinter as tk
from tkinter import filedialog, messagebox, scrolledtext, ttk
import os
import requests
import mimetypes
from PIL import Image
import shutil
import threading

# --- 설정 영역 ---
API_URL_FILE = 'api_url.txt'
SECRET_KEY_FILE = 'secret_key.txt'
FILE_FIELD_NAME = 'SS_Screenshot'
MAX_BATCH_SIZE = 300 * 1024 * 1024  # 300MB
TEMP_PROCESSED_DIR = "__temp_processed_images"
RESIZE_PERCENTAGE = 0.5 # 이미지 리사이즈 비율 (0.5 = 50%)
JPG_QUALITY = 70 # JPG 저장 품질 (기존 값으로 롤백)

# --- 유틸리티 함수 ---
def safe_log_message(msg):
    root.after(0, lambda: log_message(msg))

def safe_update_progress(val):
    root.after(0, lambda: progress_bar.config(value=val))

def load_file(path):
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return f.read().strip()
    return ""

def save_file(path, value):
    with open(path, 'w', encoding='utf-8') as f:
        f.write(value.strip())

def select_folder():
    folder_selected = filedialog.askdirectory()
    folder_path_var.set(folder_selected)

def log_message(msg):
    log_text.configure(state='normal')
    log_text.insert(tk.END, msg + "\n")
    log_text.see(tk.END)
    log_text.configure(state='normal')

def chunk_files_by_size(file_paths, max_batch_size):
    batches, current_batch, current_size = [], [], 0
    for path in file_paths:
        size = os.path.getsize(path)
        if size > max_batch_size:
            batches.append([path]); continue
        if current_size + size > max_batch_size and current_batch:
            batches.append(current_batch); current_batch, current_size = [], 0
        current_batch.append(path); current_size += size
    if current_batch: batches.append(current_batch)
    return batches

def prepare_files(folder_path):
    """
    폴더 내의 이미지를 처리합니다:
    1. 50% 크기로 리사이즈합니다.
    2. PNG인 경우 JPG로 변환합니다.
    """
    files_to_upload = []
    temp_dir = os.path.join(folder_path, TEMP_PROCESSED_DIR)
    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)
    os.makedirs(temp_dir, exist_ok=True)

    image_files = [f for f in os.listdir(folder_path)
                   if f.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.bmp'))]

    for fname in image_files:
        src_path = os.path.join(folder_path, fname)
        output_name = os.path.splitext(fname)[0] + ".jpg"
        output_path = os.path.join(temp_dir, output_name)
        
        try:
            with Image.open(src_path) as img:
                new_width = int(img.width * RESIZE_PERCENTAGE)
                new_height = int(img.height * RESIZE_PERCENTAGE)
                resized_img = img.resize((new_width, new_height), Image.LANCZOS)
                
                if resized_img.mode == 'RGBA':
                    rgb_img = resized_img.convert('RGB')
                    rgb_img.save(output_path, 'JPEG', quality=JPG_QUALITY)
                else:
                    resized_img.save(output_path, 'JPEG', quality=JPG_QUALITY)
                
                files_to_upload.append(output_path)

        except Exception as e:
            safe_log_message(f"[이미지 처리 실패] {fname} : {e}")
            
    return files_to_upload, temp_dir

def upload_images_thread():
    folder_path = folder_path_var.get()
    api_url = api_url_var.get().strip()
    secret_key = secret_key_var.get().strip()

    if not (folder_path and api_url and secret_key):
        root.after(0, lambda: messagebox.showerror("입력 오류", "모든 필드를 입력해주세요."))
        return
    
    start_btn.config(state="disabled")
    
    safe_log_message("=== 이미지 처리 및 업로드 시작 ===")
    files_to_upload, temp_dir = prepare_files(folder_path)

    if not files_to_upload:
        root.after(0, lambda: messagebox.showerror("폴더 오류", "선택한 폴더에 이미지가 없습니다."))
        start_btn.config(state="normal")
        return

    batches = chunk_files_by_size(files_to_upload, MAX_BATCH_SIZE)
    total_batches = len(batches)
    root.after(0, lambda: progress_bar.config(maximum=total_batches, value=0))

    safe_log_message(f"총 전송 파일: {len(files_to_upload)} (PNG→JPG 변환, 50% 리사이즈됨)")
    safe_log_message(f"총 전송 묶음: {total_batches} (최대 300MB씩 분할)")

    for idx, batch in enumerate(batches, 1):
        files = []
        batch_size = sum(os.path.getsize(p) for p in batch)
        safe_log_message(f"\n[묶음 {idx}/{total_batches}] 파일 수: {len(batch)} | 총 크기: {batch_size/1024/1024:.2f}MB")
        for file_path in batch:
            filename = os.path.basename(file_path)
            mime_type, _ = mimetypes.guess_type(file_path)
            if mime_type is None: mime_type = 'application/octet-stream'
            try:
                f = open(file_path, 'rb')
                files.append((FILE_FIELD_NAME, (filename, f, mime_type)))
                safe_log_message(f"- 추가: {filename} ({os.path.getsize(file_path)/1024/1024:.2f}MB)")
            except Exception as e:
                safe_log_message(f"[에러] {filename} 열기 실패 - {str(e)}")

        if not files:
            safe_log_message(f"[묶음 {idx}] 파일이 없습니다. 건너뜁니다."); safe_update_progress(idx); continue

        try:
            response = requests.post(api_url, files=files, data={"secret_key": secret_key})
            safe_log_message(f"[응답 코드] {response.status_code}")
            safe_log_message(f"[응답 내용] {response.text[:300]} ...")
            if response.status_code == 200:
                safe_log_message(f"[성공] 묶음 {idx}/{total_batches} 전송 성공")
            else:
                safe_log_message(f"[실패] 묶음 {idx}/{total_batches} 전송 실패 - 상태코드: {response.status_code}")
        except Exception as e:
            safe_log_message(f"[에러] 묶음 {idx} 전송 실패 - {str(e)}")
        finally:
            for _, (_, fobj, _) in files:
                fobj.close()
        safe_update_progress(idx)

    if os.path.exists(temp_dir):
        try:
            shutil.rmtree(temp_dir)
            safe_log_message(f"임시 변환 파일 삭제 완료 ({TEMP_PROCESSED_DIR})")
        except Exception as e:
            safe_log_message(f"[경고] 임시 폴더 삭제 실패: {e}")

    safe_log_message("\n=== 업로드 완료 ===")
    root.after(0, lambda: messagebox.showinfo("완료", "이미지 업로드가 모두 완료되었습니다."))
    start_btn.config(state="normal")


def start_upload_thread():
    threading.Thread(target=upload_images_thread, daemon=True).start()

# --- GUI 구성 ---
root = tk.Tk()
root.title("이미지 업로더")
window_width, window_height = 600, 480
screen_width, screen_height = root.winfo_screenwidth(), root.winfo_screenheight()
x, y = int((screen_width / 2) - (window_width / 2)), int((screen_height / 2) - (window_height / 2))
root.geometry(f"{window_width}x{window_height}+{x}+{y}")
root.resizable(False, False)

folder_path_var = tk.StringVar()
api_url_var = tk.StringVar(value="https://bpm-admin.myriadip.com/oms/ext/api/screenshots/uploads")
secret_key_var = tk.StringVar(value=load_file(SECRET_KEY_FILE))

frm = tk.Frame(root)
frm.grid(row=0, column=0, padx=16, pady=16)

tk.Label(frm, text="이미지 폴더:").grid(row=0, column=0, sticky='e', padx=5, pady=4)
tk.Entry(frm, textvariable=folder_path_var, width=48).grid(row=0, column=1, sticky='we', padx=5)
tk.Button(frm, text="폴더 선택", command=select_folder).grid(row=0, column=2, sticky='w', padx=5)

tk.Label(frm, text="Secret Key:").grid(row=1, column=0, sticky='e', padx=5, pady=4)
tk.Entry(frm, textvariable=secret_key_var, width=48, show="*").grid(row=1, column=1, columnspan=2, sticky='we', padx=5)

tk.Label(frm, text="API 주소:").grid(row=2, column=0, sticky='e', padx=5, pady=4)
tk.Entry(frm, textvariable=api_url_var, width=48).grid(row=2, column=1, columnspan=2, sticky='we', padx=5)

start_btn = tk.Button(frm, text="이미지 업로드", command=start_upload_thread, bg='#FFC107')
start_btn.grid(row=3, column=0, columnspan=3, pady=10, sticky='we')

progress_bar = ttk.Progressbar(frm, length=420, mode='determinate')
progress_bar.grid(row=4, column=0, columnspan=3, pady=4, sticky='we')

tk.Label(root, text="시스템 로그:").grid(row=1, column=0, sticky='nw', padx=16, pady=(0, 0))
log_text = scrolledtext.ScrolledText(root, width=80, height=18)
log_text.grid(row=2, column=0, padx=16, pady=(0, 16), sticky='we')
log_text.configure(state='normal')

root.mainloop()
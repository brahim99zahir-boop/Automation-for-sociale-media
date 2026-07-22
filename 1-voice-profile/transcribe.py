import glob, os
from faster_whisper import WhisperModel

model = WhisperModel("medium", device="cpu", compute_type="int8")

files = sorted(glob.glob("downloads/*.mp3"))
out_path = "transcripts-all.txt"
with open(out_path, "w", encoding="utf-8") as out:
    for f in files:
        reel_id = os.path.splitext(os.path.basename(f))[0]
        print(f"Transcribing {reel_id}...")
        segments, info = model.transcribe(f, language="ar", vad_filter=True)
        text = " ".join(seg.text.strip() for seg in segments)
        out.write(f"=== reel: {reel_id} (https://www.instagram.com/reel/{reel_id}/) ===\n")
        out.write(text.strip() + "\n\n")
        print(f"  -> {len(text)} chars")
print("Done ->", out_path)

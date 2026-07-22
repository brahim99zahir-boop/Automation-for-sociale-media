# Transcribing the creator's videos

## Commands used

```bash
# 1. Install tooling
pip install yt-dlp faster-whisper
apt-get install -y ffmpeg   # Debian/Ubuntu; use `winget install ffmpeg` on Windows

# 2. Download audio for each reel (put links one-per-line in downloads/links.txt)
yt-dlp --no-warnings -f "bestaudio/best" -x --audio-format mp3 \
  -o "downloads/%(id)s.%(ext)s" -a downloads/links.txt

# 3. Transcribe with faster-whisper
python3 transcribe.py   # see below
```

`transcribe.py` (medium model, CPU, Arabic):

```python
import glob, os
from faster_whisper import WhisperModel

model = WhisperModel("medium", device="cpu", compute_type="int8")
for f in sorted(glob.glob("downloads/*.mp3")):
    reel_id = os.path.splitext(os.path.basename(f))[0]
    segments, info = model.transcribe(f, language="ar", vad_filter=True)
    text = " ".join(seg.text.strip() for seg in segments)
    print(f"=== {reel_id} ===\n{text}\n")
```

yt-dlp anonymously downloads Instagram Reel media fine (no login/cookies needed) — 10 of the
11 links in `config.local.md` succeeded; `DXJ_RJcDJVA` consistently returned an Instagram-side
HTTP 500 on the media URL after 10 retries (looks like a broken/expired CDN URL for that
specific post, not a yt-dlp or auth problem — worth re-trying later, it may be transient).

## Result: this approach did not produce usable transcripts

Both `medium` and `large-v3` Whisper models were tried (including anti-hallucination settings:
`condition_on_previous_text=False`, `vad_filter=True`, `beam_size=5`). Both produced
hallucinated, largely nonsensical output — repeated phrases, invented words, and in one case
Whisper hallucinated "اشتركوا في القناة" ("subscribe to the channel") on a clip that has no
such narration at all. Two compounding reasons:

1. **These reels are short product-demo b-roll, not talking-to-camera narration.** Most clips
   are a few seconds of someone installing/showing the product with background music dominating
   the audio — there's very little continuous speech for the model to lock onto, which is
   exactly the condition that triggers Whisper hallucination loops.
2. **Moroccan Darija is not well represented in Whisper's training data.** Forcing
   `language="ar"` gets Whisper reaching for Modern Standard Arabic vocabulary/phonetics, which
   further garbles code-switched Darija speech.

I also checked whether the videos have burned-in captions I could read visually instead of
transcribing audio (extracted frames with `ffmpeg -vf fps=1/2` and inspected them). They don't
— the only on-screen text is a repeated promotional overlay ("بمناسبة افتتاح المحال جديد" / "on
the occasion of the new shop opening" + the order phone number 0666567672), not narration
captions.

**Conclusion**: per the master prompt's own rule ("never invent expressions"), I did not build
`voice-profile.md` from this hallucinated output — that would mean fabricating the creator's
voice. `voice-profile.md` in this package is instead built from the one real written sample
provided directly (a WhatsApp/DM-style reply, in the creator's actual words) and is explicitly
marked as a **draft with an insufficient sample size**.

## What would actually work — pick one and re-run this pipeline

- **Best**: paste more real examples of how the creator actually replies to customers (WhatsApp
  messages, IG DM replies, comment replies he's already written) — this is exactly the kind of
  text the system needs to imitate, no ASR risk at all.
- **Good**: links to videos where he talks to camera for 30s+ (testimonials, "why I started
  this business," Q&A-style content) rather than silent product-demo b-roll — more continuous
  speech gives Whisper something real to transcribe, and even then the output should be spot
  checked before trusting it.
- **If retrying ASR**: consider `large-v3` with a Darija-tuned model if one becomes available
  (a generic Whisper checkpoint isn't a strong match for this dialect), and manually review every
  transcript against the source audio before using it — don't trust it blind.

Raw downloaded audio for the 10 successful reels is kept in `downloads/` (git-ignored) in case
it's useful for a future re-attempt.

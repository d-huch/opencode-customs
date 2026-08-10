FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/home/tts/.cache/huggingface

RUN useradd --create-home --uid 10001 tts && \
    apt-get update && \
    apt-get install --no-install-recommends --yes gosu && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.7.1 && \
    pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY entrypoint.sh /usr/local/bin/opencode-customs-tts
RUN chmod 755 /usr/local/bin/opencode-customs-tts

EXPOSE 8880

HEALTHCHECK --interval=15s --timeout=3s --start-period=300s --retries=5 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8880/health', timeout=2)"]

ENTRYPOINT ["/usr/local/bin/opencode-customs-tts"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8880", "--workers", "1"]

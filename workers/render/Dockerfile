FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /worker
COPY render_worker.py /worker/render_worker.py

ENTRYPOINT ["python3", "/worker/render_worker.py"]

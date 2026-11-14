FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

# T2 绘图层依赖：numpy 做帧缓冲/抗锯齿/发光，Pillow 备用编解码
RUN pip3 install --no-cache-dir numpy Pillow

WORKDIR /worker
COPY render_worker.py /worker/render_worker.py
COPY spec_params.py /worker/spec_params.py
COPY gfx.py /worker/gfx.py

ENTRYPOINT ["python3", "/worker/render_worker.py"]

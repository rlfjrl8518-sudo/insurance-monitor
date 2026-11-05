# 수집 파이프라인 (Cloud Run Job). 웹앱은 web/Dockerfile.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 TZ=Asia/Seoul
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && playwright install --with-deps chromium
COPY config.json main.py classify.py sync_sheets.py push_to_postgres.py run_pipeline.py ./
COPY src ./src
COPY web/db/schema.sql ./web/db/schema.sql
CMD ["python", "run_pipeline.py"]

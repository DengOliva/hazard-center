FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py data_admin.py meeting.py pptx_export.py collection.py ./
COPY public ./public
COPY seed ./seed
RUN mkdir -p /app/data/uploads
EXPOSE 8010
CMD ["gunicorn", "--bind", "0.0.0.0:8010", "--workers", "2", "--threads", "4", "--timeout", "120", "app:app"]

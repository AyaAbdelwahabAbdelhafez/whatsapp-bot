FROM node:18-slim

# تثبيت كل مكتبات Chromium + أدوات إضافية
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm1 \
    libasound2 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    libdrm2 \
    libdbus-1-3 \
    libexpat1 \
    libxcb1 \
    libxkbcommon0 \
    libxshmfence1 \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# تصدير المنفذ اللي هيشتغل عليه Express
EXPOSE 3000

CMD ["node", "server.js"]

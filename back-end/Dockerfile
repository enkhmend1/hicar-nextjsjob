FROM node:20-alpine

# argon2 + bcrypt-style native modules need build tools
RUN apk add --no-cache python3 make g++ libstdc++

WORKDIR /app

# Install deps first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# uploads dir for local-fallback storage (when Cloudinary disabled)
RUN mkdir -p /app/uploads

EXPOSE 5001

ENV NODE_ENV=production

CMD ["node", "index.js"]

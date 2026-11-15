# For Hugging Face Spaces (Docker SDK) - alternative to Render
FROM node:22-slim
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=7860
EXPOSE 7860
CMD ["npm","start"]

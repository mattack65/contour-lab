import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    host: '0.0.0.0', port:5173, strictPort:true,
    proxy: {'/api/native': {target:'http://127.0.0.1:8000',changeOrigin:true,rewrite:path=>path.replace(/^\/api\/native/,''),timeout:620000,proxyTimeout:620000}}
  }
});

import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, readFileSync, writeFileSync } from 'fs';

const copyPlugin = {
    name: 'copy-extension-files',
    closeBundle() {
        copyFileSync('manifest.json', 'dist/manifest.json');
        copyFileSync('src/content/timedtext-interceptor.js', 'dist/timedtext-interceptor.js');

        let popupHtml = readFileSync('popup.html', 'utf-8');
        popupHtml = popupHtml.replace('src/popup/index.ts', 'popup.js');
        writeFileSync('dist/popup.html', popupHtml);

        const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf-8'));
        manifest.content_scripts[0].js = ['content.js'];
        manifest.content_scripts[0].css = ['content.css'];
        manifest.background.service_worker = 'background.js';
        manifest.background.type = 'module';
        writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2));
    },
};

const contentBuild = defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        cssCodeSplit: false,
        sourcemap: 'hidden',
        rollupOptions: {
            input: {
                content: resolve(__dirname, 'src/content/index.ts'),
            },
            output: {
                entryFileNames: '[name].js',
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name?.endsWith('.css')) return 'content.css';
                    return '[name][extname]';
                },
                format: 'iife',
                inlineDynamicImports: true,
            },
        },
    },
    esbuild: {
        keepNames: true,
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },
});

const moduleBuild = defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: false,
        sourcemap: 'hidden',
        rollupOptions: {
            input: {
                background: resolve(__dirname, 'src/background/index.ts'),
                popup: resolve(__dirname, 'src/popup/index.ts'),
            },
            output: {
                entryFileNames: '[name].js',
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name?.endsWith('.css')) return 'popup.css';
                    return '[name][extname]';
                },
                format: 'es',
            },
        },
    },
    plugins: [copyPlugin],
    esbuild: {
        keepNames: true,
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
        },
    },
});

export default defineConfig(({ mode }) => {
    const target = process.env.BUILD_TARGET;
    if (target === 'content') return contentBuild;
    return moduleBuild;
});

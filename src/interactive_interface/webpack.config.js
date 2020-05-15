const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const TerserPlugin = require('terser-webpack-plugin-legacy');

const MonacoEditorSrc = path.join(__dirname, 'node_modules', 'react-monaco-editor');
const VSMonacoEditorSrc = path.join(__dirname, 'node_modules', 'monaco-editor', 'min', 'vs');

let distDir = path.resolve(__dirname, 'dist');

module.exports = {

    entry: {
        jsx: './src/index.tsx',
        // html: './public/index.html',
        // vendor: ['react', 'react-dom']
    },
    output: {
        path: distDir,
        filename: 'interactive.js',
        publicPath: './',
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js'],
        alias: {'react-monaco-editor': MonacoEditorSrc}
    },
    module: {
        rules: [
            {
                test: /webworkerscript\.js$/,
                use: { loader:'worker-loader' },
            },
            {
                test: /\.tsx?$/,
                loader: [
    // To use babel in lean-client-js-browser, add the following to this package.json
    // "babel-core": "^6.26.3",
    // "babel-loader": "^7.1.2",
    // "babel-polyfill": "^6.26.0",
    // "babel-preset-env": "^1.7.0",
                    // 'babel-loader?presets[]=env',
                    'ts-loader'
                ],
            },
        ],
    },
    devServer: {
        contentBase: distDir,
        publicPath: '/',
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: 'public/index.html'
        }),
        new CopyWebpackPlugin([
            { from: VSMonacoEditorSrc, to: 'vs', },
            { from: 'public/interactive.css', to: 'interactive.css', },
            { from: 'public/lean_logo.svg', to: 'lean_logo.svg', },
            { from: 'public/display-goal-light.svg', to: 'display-goal-light.svg', },
            { from: 'public/display-list-light.svg', to: 'display-list-light.svg', },
        ]),
        new TerserPlugin(),
    ],
    node: {
        child_process: 'empty',
        readline: 'empty',
    },
    externals: {
        // react: 'require("react")',
        // 'react-dom': 'require("react-dom")',
        'MathJax'     : 'MathJax',
    },
};

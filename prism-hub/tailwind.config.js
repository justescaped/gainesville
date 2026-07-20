/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0B0B0C', panel: '#151517', line: '#26262A', fog: '#8A8A90', bone: '#E8E8E6',
        tred: '#FF3B3B', tblue: '#2E86FF', tgreen: '#21D07A', tyellow: '#FFC61A'
      }
    }
  },
  plugins: []
};

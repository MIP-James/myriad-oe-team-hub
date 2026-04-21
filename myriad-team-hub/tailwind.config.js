/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        myriad: {
          primary: '#FFB300',
          primaryDark: '#E6A200',
          ink: '#111111'
        }
      },
      fontFamily: {
        sans: ['"Malgun Gothic"', '"Noto Sans KR"', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
}

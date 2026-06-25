// 온라인 모니터링 보고서 — 파싱 + 요약 계산 엔진
// 프레임워크 무관 순수 로직. MonitoringReport.jsx 가 이 모듈을 사용.
// 엑셀 파싱은 허브 표준인 ExcelJS 사용 (SheetJS 미도입 — 의존성 0 추가).
import ExcelJS from 'exceljs'

// 브랜드 색상 팔레트 (보고서 디자인 고정값)
export const C = { ink: '#17150F', amber: '#EAA00A', amberDk: '#B5760C', tan: '#B79A5E', gray: '#9B8B6A' }

// 좌상단/툴바 로고 — 흰색(어두운 배경용) / 어두운(밝은 배경용) 2종 (base64 인라인)
export const LOGO_WHITE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJgAAAA0CAYAAAB2HPG0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAABWrSURBVHhe7Zx5uF1Vef+/33fvM9/c3CQ3SCBof20RERwYnp8to0XxJ2EwpIAjqFiKgFSKiFVBBiVqiyKTTK1SwiQUlV8rOAEySUQQlEgCoiKtQCHDvfuce+a9vv3jrB12ds7NcBOSW577eZ7zJGe9a629z77f/a613vXuDUwxxRRTTDHFFFNMMcUUr3wkMVs22dBNCLJlU0w+LFsgKZB0uqTpWdtkYem1+NDvutglWz7F5KOvp3LO/QbAzwEcZ2ZjWfvWZNn1OMk5nAfhna8/Gouz9iy1RuO4wOxAl8udUjF7NmuXNNxstb4m535ZLZUuqzQaXwrDcLDdbJ46ODi4PKm3fPnywUqlcokDnuu0Wl/O5/NfCPP513Tb7RBmkHMIc7nFrttdVCqVngKARqPxZwK+IuDHlVLpkvRxx8bGtgtyua/GcdzttFonDw0NrUrba7XaZ0rl8l7NZjNHABYEjLvdFQzD73WazdunT5++Il1/srKWB/O0Sb4XwMXOuUrWuLVYugjHh4bzjSgwQDdr74dJbyjm80ei0Tg1awOAsUbjxGKh8H4HvGUbYIzkrwu53NEWhiem6xXL5eMLxeLRcO7BwcHBjoCDXBzPA7kDpB1I7iDnTqXZnfV6fT8ACIJgKAzDd0HaI90XAJB8TyGXe3e5WHx/WCjMz9rN7C+NPJjAnwLYwTk3F+SecO6aQrH4781mc6dsm8nIeAITehfhw5IunAwie/xaHBeG+CqJooA4ax8PSR0AoNkJY2Njf5G2tarVXQic7Cu2SapUKHyj3mj8OJ/L/X2r1XoDADSbzR0Ds083ms0byuXyd6IoygFQHMcPl4rFNyafbqfzXiPnCPiUJLbb7bjT6XQBdNLHdc4NMgiOazab9zZbrV9QOklSOV0HZLfeaNQk/VWpVEqOsbucO5nknnEcX+Wcm7ZGm0nIeAJbjZl9BMD5zrlS1raleHIRjg0DXACiHLusdd2QZLPddmZmJM92zhUA4Kabbgq6YXgGyUKz1WrQjOj93hakMwDk4zg+S1IxjuNzzQwBeS5JR5Lo3YUi2U0+lUrl+51u92kAO0rKJzdqlnqzeXg+DF8Xx/FCkJfm8/k96q3WO7L10BNjJ+nfzKqVSuXSTrf7L6Vyed9Wq7V3tv5kY70CQ++P9FFJX5ZUzNpebpZegw8zwIVGVOIN9lspSLo4rsfd7kUCDqy3Wu8DgHnz5h0E6UhI57s4fiF9LSqVys867fZlAg4fazTOp9mCTrf7j8VicdkafWcEVK/X32xmrzLyOZId5HJpM9ATTAHAic1W69FKpXJnY2zslk63+zScO0nSWivjRMxrlJndzp53flPWNtnYIIGhd2efLOmLW1JkyxbhA2EOF9Iw0J2IuF4idM4tIvA9AmdVq9VdYHYWpHtqtdpVIsNsaKZUKn2V5JOVUukkJz3SrNe/nrYD6IZBMLfRaHx+bGzs82NjY+fT7LogCKzb7V5G0qHTWev61uv1A/Jh+H8FfFfSUC6XKzrnbjOzv2o0Gntl6/cljhMhbqQ/3/KsdQHWBclTJJ2XDDMvJ8tuwLsZ4BIS0zZRXABg3W53LAiCzxIYKhQKNxJ4HYDPxHEcsc91MLNnnXQDAATkouHh4ShTJSa5rZM+QbOPgTwhl8u9tt1qnTJt2rQbASCX8WCSzMz+JghDkPxIs9n8aRAE9wfkuwr5fGDAsWs06LXpJ6LDYudA8pGsYbKx1oVdHyRPlbTQzzFeFpZdj6MoXB4EmL4ZxAX0VnSFQqHwGM0uzuVyu5L8RqVSWVwqlca9WWg2AgBx/1BNvtPp/NrIXSC9icAJzrluEAR/kvWGCfV6fXczO6TZaHyL0icAnAngTJKnNBqNH8jsyGazuXNSX5LlcrmhlStXTl+5cuX0Wq22ba1e/3QQhh9qt1q3j4yMPLDmESYfGy0wvCSy8yStPcnYRJZdhyMpXBEGGOpuUCBiPZChmeWTmF/c6Vxar9e/BOkrPTMJoABgrd/CpMy5NWzsUSQZl0ql35fL5WdKpdKibrd7dZjLfbbdbr8nqZrL5ULnr5OZnQwg78JwYblcvrlcLt9QLpdvKBaL/2Zm5xcLhUrXuRMlmZOCSrlcdtIdhWLx0UKx+CiD4EEzO9tJPyR50pw5c/oJf1IxUYEBwCecc5tVZEuvxxEkrghCDHU2h7gAwLnFzrlvmvdGAwMDz1cqlU+Xy+Vn0AtBtARcR/KObFNKSzrd7o0mPZEubzQaTQE3Qrp1dV1Scu7Mdrv9z3Ec7ygpiON4eafTuZpmd0sqioziOD5vIJ9fku4PAAqFwv31ZvMrJNvPPvtsMSB/0Op0rhdwn5GLQT4o6T8EvLtZrx9VKpV+n+1jMtLXlTvnlpBc71aMnx+c//jjj5+56667trP2jWHpIhxhhivCADM76xgWzYDYYQzEW3d+Hx7K2qeYXEzIgyWQNACn7bzzzuduiidbeg3+2gJcHoTrFtcU//vYJIHBi4zkac65cyYy8X/iehxuIS4PA8zaLHOuKSYVmyww9EQWkDxd0uc2xpMtuw7zAVweGoY325xriknFZhEYvMgA/IOkMzdEZEuvx2HsiWubqWHxlcsmTfL7ISlut9ufLxQKXyDZVzpLr8GhFuLKIMC2Gzssbuwk3zk3F0DBzH4rKZS0I8n/JFnL1PszADUAXfQyGATAkXSSQn+tRkk+BeC1ACqZeJcD8ATJhqSdSf6R5EjKDkk5STsB+IOZVTM2SvpTANP73Pi/M7OVyRfn3DYkd/DHf87M/ihpuqQdkyqZ845IjkqaRvIpkqu3uCTNkLQtySdIrg7qrly5cvrQ0NBrSD5JspmU+yD7jgB+vyGpXC+HwDBWr3dGVq06a+7cuf+YFdnj1+PgALgqDDBnIsPiBAT2VQCvNbNDnHOzJf2E5G0kT08utCST9O8A7gHwKIDPo5exMQxgGoA/+Gv1gA+O3gsgD2DElxNAk+TxAJ6R9GsAp5jZ6jCGP5ftAdwP4FgzuzNjKwD4LoCdADyfEhkBfMbM7pCUl/S3JI8AMCDJkawD+D6AZZI+5dsMAZgF4Gl/ozzkf8NBJN9BcnV2h6QjJX2O5Ft8X0n5P0g6I47jY3K53LeTcn8j/gTAEWb2s6R8PLJ3yibh4hi1Wg1jY/Vco9k8Z/HixZ+UtPoYy67BO0PiyomKa4KUvUjQG8k5QPI0AB/M1JtGcoa/eIcAOAzAtwC8AGA+gENIfs4HZbcF8BVf5zAAhwI4AsBTPmA7RLLfgsdIDvUL6nq2AfBtAO/K9H2fv47nAjhN0o0AFpA8TNLXJe0h6bepNpdIGiX5HgCHkvyM738oczz4hdlQ2htLGnbOHQXgCTM71nvCBPP9pMvGZbMJzDmHeqOB2lgNoyMjqNVquXqjce4tt9xyGs6SLbsGBzDElYFhuy0oLvihK72f55xz90s62zm3Oj/MDykys5aZvWBmLwIY9Z7peTN7geSo9ygC8LyZvejrvmBmL5JMflksqW+qjqTYtx+PFZl+XzCzlqTdnXPHATjNzC4n+Yw/r5sAHGNmj/l2LwJYBaDlzzE57+x1SJD31mmO9DlsxwLYVdIam/B+VFrXb1jNZhFYT1x1VGs1VKMaoijCqlWrUK3VcrV655x7d/rrheyFInbYwuLqR57kxX5YudI5Nzc998hgXlDZNJoWgGOdc+c4577gnPuic25Bps5EaAGYl+r3POfc36D3R327n9d9N9vIzBrZIgDsl/6zPpxzFUkfJnmDmf2S5N0AThhvf3V9bLLAnHOo1+uoVmuoVquIqhGiaoTR0QirRsb0qtzDnTcM3/nxoQq2a3f73kFbGgPQBPBJAA0Al/qLmr2L10fZDxVDfmK+ZkbqxBCAYqrfIQAD8MMWgFrKS24s4wlEaRvJAyVNr9Vq1/qiSwHsI2lCc/JNElgyLFZrNdS8wKrVCFEUYbTa0OzcL6p7DV8ZDuZHikMDyA1VUFN/N72lCf0q7qMAdgNwhg+zbJDb917wcjP7uJl9zMxONLPkDzJhSBYA3Jrq9yQz+5q3LQGwvXNudrbdBlIDUM7Mp+AXCy2Sbb/Y+QjJcGBg4Gjn3KkA3gZgBoBjMu02iAkLzDmHRqPhRVXFaDTaE9ZohNGooW1yj0b7Dl+ZGwijUtcBZsjPmo7C9MkjMpjZIwA+DuBYSbtnc+fXxTh5Wmn67c0mzzr0syWMJ/Lve897TvoZCb+y3GcD8vMfATCb5Oo0ay+2g0k+RLIjaU8Af+FXy7sBeDPJnQDcCWBBFEXDPowDkq01eh+Hvm5zfWGKOI7RaDZRq9VQjfywGEUYGRlFVG1gOPdotM+sK3LTciOlOHW5SMAJrRURWqNjGOiX6Lc+JhCmuArA681sb+fcqwAsBfBRPzlO6nyW5BcknWdmZ6TLARxFco9kaPJ9POZXez8laan5yU9IvijpOQDXAXiAJL19JYDHSf5c0jcBPJqyjZK8TdL9PkTxLb/PC0lG8hckH5X0dklf8+GH2wC0JO1vZq9vt9sfLBQKv/bn+EFJZ5LcLYm3Sco75y4kuT+Aq0m+IGlfAHsD+ADJX0i6VtI0MzssHStzzg36xxj/meTNPgxzEYBl/jcYyZV954fZgvXhnHtJXH7OVa1WEUURolpTs3K/jPbuIy4AkAAjCrMGe55snFXN5uYhAHehd9c1AdwK4D/TFUheIOlSL740SwH8KO1VfB+3AJgDYIGk+T6sMB/AXD+v+463H+7th/uhpivpZh/ITdsO9KvO2/yKboGk+d4+X9Lr/LF/DGABgAckvQPAYST/S9JJCxcuTJ/70wBuT7yNb9sm+Skvsj0lLfCr5A+Y2UMABv2K+fy0uNDz9BGAL5OcJSkmeTOA16d+w3xJb0u3SdgoD7Z6WEzEFfU8VxRFGI0amBn+Mtp3+PJwWriqnBVXmrQni8YwsDFC31gPlniXVFB1je/Zupkod9+6vrzfObveDd3XLh8K2Vgbkn7TBckKMRvI9ra+553gY2pMt02O3a+/BH/MxClkz1P9VuPZSuOSFVc16s29oijCSNTQjOBX0T7DV6xXXMh4ssEKak7jzjs2GZJKX+js9zTZ8vHq+vK4z0frsLsJ2lb3mzmHmOOIYbzzTvCP3q3RNjl2uixLci7jnOda4sKGCiwrrp7HGsXIyChGoqZmBo9V9519eTgYrlyvuBISkc2chsL0Cqp6GUU2xdZjvQJzzqHZbPogas9zrR4Wq03MCB+r7jv7so0SV4IEBIbC8CDy06ZE9opknQKT5EMRPs5VS60YoyZmBEui/WZNTFwJEmCG4vAg8oPlKZG90linwBqNBmq1sdWxrsRzjURNTOfj1f2Gvx4M5lZMWFwJEhAairOmT3myVxp9V5HdbneJpF1WrFy5RpxrtDehxyCW1fabfYkN5V8su80oBSPQdWj61eUgufb5bewq0jk3D8Db/e4/AXTiOL43DMP/8MHF0Adad/Z7jiYpIvk9M7s/09dckvMkvdHvG/4UwPeTvCj/ApPTJQ35m9cAPAfgZjN70vfxNgDzMhkVAYB7zexG59xrAXwYQBJMJYBlAG4k2ZJ0OoCZPpzR9GlDgf/eJnkTyYdTfcM5tz+AN5G8LJ2qsyXo68Hqdb9x7T1XNRWKmIYnavvNvtRmbGZxAYDrzcmKw4PIT9t8w+XBAN4HIPLbJWEQBAslXbRkyZK8vwZ/6yPYEYAqyTmSFjnnPpbchM65eZJ+5ONHdd/uswBudc79uT9WWdInAbwaQNV/9vR1/p+vc4DPUqiRrPscrJoXLHwy3yf9cccA1EkeCeD/A/hzX7cKoCDp73zqUA3AcpLbSvpa+kU1zrmZki5wzrktLS6M58Geff75JZ12e5cVK1b47Z9RjERNDOCJ6v7DF9uMwguVTR0W1wUJOIfGiyPoVBsYTL/+YwIe7OsAXmdmB6TK9gbw7TiO3x+G4R2SHgJwi5ktTNU5XtIZ9Xp9z4GBgYqkewAsArAwFR1/taSrvHc8xG94/wbA+83sdt9PAcCXAexFcm9JZ5F8J8k9k2Olcc4dDGARyf/j02wgaVjSrZIeDoLg73y97STdT/J9ZvaAL5sD4G4AF5jZZb7t2ZL2IXlIOjN1S9HXg1WjCNFoT1iJuCp4srrf8KUvu7jw0sS/NDyE3EAJUf/Mqo1ijRuJ5M8A/HcQBG9MxYuyqS0/JDkwMDAw12/0/heAs9OpziSfAXAKgDcC2Ce1P7d6Q9nMWj5Cv73Puoh96nY5+TjnSunETPSEsTphkeRyAPekRekTGpkeas3sOefcF/1D0XOazeZOzrmj4zg+b2uIC+MKLEm7iSKMRk1U9FRt/1mX2MzC8y+7uBJ8CKM0e/OIbI0AoqQdAAzHcfx0UpYdPuI43kVSV9JySXtJus+LJcvv/Dxr11TKT3Yzezc/rCU5/ztL+qmkByQtBvAjn4+fID+/6n3piW9XSet9mjsIghskPQXgc7lc7lwAP8jlcndl620p+gssihCNjmK02kRJv63tP/tizCxuOXElJCLbZghhpYjqBEUW+1dQHuM/J/kN218FQfAj/wRUV9JbUnVOD4LgQgDXei8VryPN2bz3S/b9COCgVF8XAPgYgH/yXiQP4PckPwLgOADHkfw4gD/69vJ1Ppjq45uS3kzywtRx+0KySfJsAEeQ3MPMvpStsyXpK7BkWCy539XeOvtizCw8N7ClxZXgh8vyJois63Pdj/KT/YMkfcvM3mtmVe8dugDe4FOF3+tz2B8xs9P8EHqXXz2uldPe7XZ3l7Q9gAdTQ+N+AN7tjzcLwIfM7F+8zUjWSD5sZg+a2c/8/5OsVHkxL/B9nEjyAySPM7MHfZ11YmaLfcbHXf4G2Wr0FdhI1GTYeaq1/+yLMbPw7FYTV4IEBAFK28xAUMijvpFry4IXyyFm9k7/7z+RTL/VuQjgajM71MwOknSCpDdL+hNv/yaApqR/Ta0Y4ZzbPwzDq0l+h+TPvecRgDPN7GB/vGPMbK0Xq6wD86vUI83sYJIHAPihX0RsDA3fz1alr8AGg2Xtt25zUWH2tD8OWA7I5bf+J8wBhRLK281EeaCEjuuuNSkfj5wX0LpY4/VNJG8keReAbzjnZvkHOo70E+/vOOfu8Q+OXAXgdpIn+81eA1Ba3xM3knaT9BPn3N3+c59z7iJvTvow9M6l3ul0TgNwqHPu+FQfBFBM8sb6UPSC36r0DVP84Xs7HvPqgd9s3+pupK/YAoQGtrqoLR/DLa+Zj7Xee5/FOfcmktNI3pe14aUJ9H6SnjOz1a9p8g+yvpXk/X4VB7/6293nc3UBPJZpk5d0IMmHST6flKdxzu0EYJc+f/wXzewOn9C4J4AfpxcV/tG0ATO7238vS9oHwMNmttY7851zfwlgzMx+lbVNMcUUU0wxxRRTTPHK5n8AFr7eE7DhACcAAAAASUVORK5CYII='
export const LOGO_DARK = 'data:image/png;base64,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'

// ---------- 헤더 동의어 매핑 (한/영) ----------
const SYN = {
  week: ['Week', '주차', '기간'],
  infrType: ['Infringe Type', 'Infringement Type', 'Infringing Type', 'Infringement', '침해여부', '침해유형'],
  brand: ['Client', 'Brand', 'Brand Name', '브랜드', '고객사', '클라이언트'],
  productName: ['Product Name', 'Listing title', '상품명'],
  productType: ['Product Type', '상품 유형'],
  model: ['Model', 'Model Type', 'Line', '모델', '라인'],
  productNo: ['Product No', 'Product No.', 'Product Number', '상품 번호', '상품번호'],
  price: ['Sell Price (KRW)', 'Selling Price (KRW)', 'Price (KRW)', 'Price(KRW)', 'Price', '판매가격'],
  productUrl: ['Product Url', 'Product URL', 'URL', '상품 URL', '상품URL'],
  platformType: ['Platform Type'],
  platform: ['Platform', '온라인플랫폼'],
  storeName: ['Store Name', '스토어명'],
  storeUrl: ['Store Url', 'Store URL', '스토어 URL'],
  sellerId: ['Seller Id', 'Seller ID', '판매자 ID', 'UserID/Website Name', 'User ID', 'UserID'],
  kakaoId: ['Kakaotalk Id', 'Kakao Talk ID', 'KakaoTalk ID', '판매자 카톡ID', '카톡ID'],
  company: ['Company Name', '판매업체명'],
  bizNo: ['Business No.', 'Business Reg. No.', 'Business Reg No', '사업자번호', '판매업체 사업자번호', '사업자등록번호'],
  netBizNo: ['Internet Business Reg No', 'Internet Business Reg. No', '통신판매업번호', '판매업체 통신판매업번호'],
  repName: ['Representative Name', 'Owner Name', '대표자명', '판매업체 대표자명'],
  sellerName: ['Seller Name', '판매자명'],
  email: ['Seller Email', 'Seller E-mail', '이메일', '판매자 이메일', 'Email'],
  phone: ['Seller Phone No', 'Seller Phone Number', '전화번호', '판매자 전화번호', 'Phone number'],
  address: ['Seller Addr', 'Seller Address', '주소', '판매자 주소', 'Address'],
  iprNo: ['IPR No.', 'IPR No', '권리번호'],
}
const SYN_KEYS = Object.keys(SYN)

export const norm = (s) => (s == null ? '' : String(s).toLowerCase().replace(/[\s.\_\-\/()#:’'`,]/g, ''))
const NM = (() => { const m = {}; for (const [c, arr] of Object.entries(SYN)) for (const s of arr) m[norm(s)] = c; return m })()

// ExcelJS 셀 값 정규화 (rich text / 수식 결과 / 하이퍼링크 객체 대응)
function cellText(x) {
  if (x == null) return ''
  if (typeof x === 'object') {
    if ('text' in x) return String(x.text).trim()
    if ('result' in x) return String(x.result).trim()
    if ('richText' in x && Array.isArray(x.richText)) return x.richText.map((r) => r.text).join('').trim()
    if ('hyperlink' in x) return String(x.hyperlink).trim()
  }
  return String(x).trim()
}

export const fmtPrice = (v) => {
  if (!v) return ''
  const d = String(v).replace(/[^\d]/g, '')
  return d ? '₩' + Number(d).toLocaleString('en-US') : String(v)
}

export const bucketOf = (t) => {
  const n = norm(t)
  if (/counterfeit|위조|모조|가품/.test(n)) return 'Counterfeit'
  if (/design|디자인/.test(n)) return 'Design'
  if (/copyright|저작/.test(n)) return 'Copyright'
  if (/trademark|상표/.test(n)) return 'Trademark'
  return 'Other'
}

const extractPeriod = (name) => {
  let m = name.match(/week\s*0*(\d+)/i); if (m) return 'Week ' + m[1]
  m = name.match(/\d{1,2}\s*월\s*\d\s*주/); if (m) return m[0].replace(/\s+/g, ' ')
  m = name.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}/i); if (m) return m[0].replace(/\s+/g, ' ')
  m = name.match(/\b(\d{4})[.\-_](\d{1,2})\b/); if (m) return m[1] + '.' + ('0' + m[2]).slice(-2)
  return ''
}
const guessMode = (tag) => {
  const n = norm(tag)
  if (/week|주차|주간|wk/.test(n)) return '주간 Weekly'
  if (/month|월간|월|aug|jul|jun|sep|oct|nov|dec|jan|feb|mar|apr|may|\d{4}\d{2}/.test(n)) return '월간 Monthly'
  return '기간 Period'
}
export const derivePeriod = (weeks, stem) => {
  weeks = (weeks || []).filter(Boolean)
  if (weeks.length >= 2) {
    const nums = weeks.map((w) => { const m = String(w).match(/\d+/); return m ? +m[0] : null }).filter((n) => n != null).sort((a, b) => a - b)
    const tag = nums.length >= 2 ? ('Week ' + nums[0] + '–' + nums[nums.length - 1]) : weeks.join(', ')
    return { tag, mode: '월간 Monthly', range: weeks.join(' · ') }
  }
  if (weeks.length === 1) return { tag: weeks[0], mode: '주간 Weekly', range: '' }
  const t = extractPeriod(stem) || '—'
  return { tag: t, mode: guessMode(t), range: '' }
}

// ---------- 엑셀 파싱 (ExcelJS, 다중 시트 + 스마트 헤더 탐지) ----------
function sheetToAoa(sheet) {
  const maxR = sheet.rowCount, maxC = sheet.columnCount
  const aoa = []
  for (let r = 1; r <= maxR; r++) {
    const row = sheet.getRow(r)
    const arr = []
    for (let c = 1; c <= maxC; c++) arr.push(cellText(row.getCell(c).value))
    aoa.push(arr)
  }
  return aoa
}

export async function parseMonitoringExcel(file) {
  const buffer = await file.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const rows = [], weeks = []
  for (const sheet of wb.worksheets) {
    if (!sheet || !sheet.rowCount) continue
    const aoa = sheetToAoa(sheet)
    // 상위 15행 중 동의어 매칭이 가장 많은 행을 헤더로 판단
    let hr = -1, best = 0
    for (let r = 0; r < Math.min(aoa.length, 15); r++) {
      let cnt = 0
      for (const cell of (aoa[r] || [])) if (NM[norm(cell)]) cnt++
      if (cnt > best) { best = cnt; hr = r }
    }
    if (hr < 0 || best < 4) continue
    const map = {}
    ;(aoa[hr] || []).forEach((cell, c) => { const canon = NM[norm(cell)]; if (canon && !(canon in map)) map[canon] = c })
    for (let r = hr + 1; r < aoa.length; r++) {
      const row = aoa[r] || []
      const get = (k) => (map[k] != null ? String(row[map[k]] == null ? '' : row[map[k]]).trim() : '')
      const o = {}
      for (const k of SYN_KEYS) o[k] = get(k)
      if (!o.productUrl && !o.platform && !o.productName && !o.storeName && !o.sellerId && !o.brand) continue
      o.price = fmtPrice(o.price)
      rows.push(o)
      if (o.week && weeks.indexOf(o.week) < 0) weeks.push(o.week)
    }
  }
  return { rows, weeks }
}

// ---------- 분포 / 요약 ----------
export function dist(rows, keyFn) {
  const m = {}
  rows.forEach((r) => { const k = (keyFn(r) || '').trim() || '(미상)'; m[k] = (m[k] || 0) + 1 })
  const arr = Object.entries(m).sort((a, b) => b[1] - a[1])
  const total = rows.length || 1, max = Math.max(1, ...arr.map((x) => x[1]))
  return arr.map(([name, count]) => ({ name, count, pct: Math.round((count / total) * 100), frac: count / max }))
}

const TYPE_META = [
  ['Counterfeit', '위조품', 'Counterfeit', C.ink],
  ['Design', '디자인', 'Design', C.amberDk],
  ['Copyright', '저작권', 'Copyright', C.amber],
  ['Trademark', '상표', 'Trademark', C.tan],
  ['Other', '기타', 'Other', C.gray],
]
export function typeDist(rows) {
  const tc = {}
  rows.forEach((r) => { const b = bucketOf(r.infrType); tc[b] = (tc[b] || 0) + 1 })
  const present = TYPE_META.filter((t) => tc[t[0]])
  const total = rows.length || 1, max = Math.max(1, ...present.map((t) => tc[t[0]]))
  return present.map(([key, ko, en, col]) => ({
    ko, en, col, count: tc[key], pct: Math.round((tc[key] / total) * 100),
    frac: tc[key] / max, segPct: (tc[key] / total) * 100,
  }))
}

export function summarize(brand, rows) {
  const sellers = new Set()
  rows.forEach((r) => { const s = r.sellerId || r.company || r.storeName; if (s) sellers.add(s) })
  const platforms = new Set(rows.map((r) => r.platform).filter(Boolean))
  const types = typeDist(rows)
  const kpis = [
    { ko: '탐지', en: 'Detected', val: String(rows.length), sub: '적발 건수' },
    { ko: '적발 판매자', en: 'Sellers', val: String(sellers.size), sub: '중복 제외' },
    { ko: '적발 플랫폼', en: 'Platforms', val: String(platforms.size), sub: '마켓·소셜' },
    { ko: '침해유형', en: 'Types', val: String(types.length), sub: '유형 수' },
  ]
  return {
    brand, count: rows.length, kpis, types,
    platform: dist(rows, (r) => r.platform),
    ipr: dist(rows.filter((r) => r.iprNo), (r) => r.iprNo),
    line: dist(rows.filter((r) => r.model), (r) => r.model),
  }
}

export const uniqBrands = (rows) => [...new Set(rows.map((r) => (r.brand || '').trim()).filter(Boolean))]
export const defaultCover = (rows) => {
  const b = uniqBrands(rows)
  return b.length > 1 ? b.join(' / ') : (b[0] || '(브랜드 미상)')
}

/**
 * BPM ADMIN 고객사별 [상품 유형] 목록 일괄 수집 스크립트  (bpm-assist / brand_types.js 갱신용)
 *
 * 사용법 (약 1분)
 *  1) 크롬에서 BPM ADMIN 로그인 → 고객사 관리 목록 페이지로 이동
 *     https://bpm-admin.myriadip.com/oms/config/client_list.do
 *  2) F12 → Console 탭 → 이 파일 내용 전체를 붙여넣고 Enter
 *  3) 자동으로 [조회]를 한 번 눌러 인증 헤더(X-CSRF-TOKEN)를 잡은 뒤,
 *     권리자(BRD) 고객사 전체의 상품 유형을 6개씩 병렬로 내려받아
 *     collected_YYYY-MM-DD.json 파일을 다운로드합니다 (약 640건 요청, 10~20초)
 *  4) 내려받은 파일을 이 폴더(Claude Project\utilities\bpm-assist-sync)에 넣고
 *        python build_brand_types.py collected_YYYY-MM-DD.json
 *     → Downloads\bpm-assist\brand_types.js 가 다시 생성됩니다 → release.bat bpm-assist 로 재배포
 *
 * 참고: 목록 페이지의 "바로 가기 > 상품 유형" 이 호출하는 것과 같은 내부 API 두 개만 사용합니다.
 *   POST /oms/config/client/list              (고객사 목록)
 *   POST /oms/config/client/producttype/list  (고객사별 상품 유형)
 */
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1) 인증 헤더 캡처: 페이지의 XHR 이 붙이는 X-CSRF-TOKEN 을 가로채 재사용 (토큰은 콘솔에 출력하지 않음)
  const cap = {};
  if (!XMLHttpRequest.prototype.__mipHooked) {
    const sh = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
      if (/^x-csrf-token$/i.test(k)) cap.token = String(v);
      return sh.apply(this, arguments);
    };
    XMLHttpRequest.prototype.__mipHooked = true;
  }
  const searchBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("조회") && b.offsetParent);
  if (!searchBtn) throw new Error("고객사 관리 목록 페이지의 [조회] 버튼이 안 보입니다 — client_list.do 에서 실행하세요");
  searchBtn.click();
  for (let i = 0; i < 40 && !cap.token; i++) await sleep(100);
  if (!cap.token) throw new Error("인증 헤더를 잡지 못했습니다 — 페이지를 새로 고친 뒤 다시 실행하세요");

  const post = (u, b) => fetch(u, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "X-CSRF-TOKEN": cap.token },
    body: JSON.stringify(b),
  }).then((r) => r.json());

  // 2) 고객사 전체 (홀딩 필터 없이)
  const cl = await post("/oms/config/client/list", {
    pageNo: 1, pageSize: 1000, holdingClient: "", clientName: "", linkClientName: "", clientType: "",
    serviceManager: "", serviceManagerName: "", globalType: "", serviceRole: "", signAgreeYn: "",
    reactMemberYn: "", collectYn: "", stpCaptureYn: "", useYn: "", orderBy: "CNAME",
  });
  if (cl.code !== "OK") throw new Error("고객사 목록 실패: " + cl.code + " " + (cl.message || ""));
  const all = cl.data.list;
  const brd = all.filter((c) => c.clientTypeCd === "BRD");
  console.log(`고객사 ${cl.data.totalcount}곳 중 권리자(BRD) ${brd.length}곳 — 상품 유형 수집 시작`);

  // 3) 고객사별 상품 유형 (6개 병렬)
  const out = []; let idx = 0, errs = 0;
  async function worker() {
    while (idx < brd.length) {
      const c = brd[idx++];
      try {
        const r = await post("/oms/config/client/producttype/list", {
          pageNo: 1, pageSize: 500, productName: "", modelName: "", clientId: c.clientId, productTypeName: "", modelTypeName: "",
        });
        const list = (r.data && r.data.list) || [];
        out.push({
          id: c.clientId, name: c.clientName, abbr: c.clientAbbr || "", holding: c.reprClientName || "",
          useYn: c.useYn || "", global: c.globalTypeCdName || "", total: r.data ? r.data.totalcount : null, code: r.code,
          types: list.map((t) => ({ name: t.productTypeName, std: t.stdProductTypeName, stdId: t.stdProductTypeId, useYn: t.useYn, models: t.modelListInfo || "", modelCount: t.modelCount })),
        });
      } catch (e) { errs++; out.push({ id: c.clientId, name: c.clientName, error: String(e) }); }
      if (out.length % 100 === 0) console.log(`  … ${out.length}/${brd.length}`);
    }
  }
  await Promise.all([0, 1, 2, 3, 4, 5].map(worker));

  const result = {
    fetchedAt: new Date().toISOString(), totalClients: cl.data.totalcount, brdClients: brd.length,
    clientTypes: [...new Set(all.map((c) => c.clientTypeCd + ":" + c.clientTypeCdName))], clients: out,
  };
  const withTypes = out.filter((o) => o.types && o.types.length).length;
  console.log(`완료: ${out.length}곳 수집 (상품 유형 등록 ${withTypes}곳, 오류 ${errs}건)`);

  // 4) JSON 다운로드
  const day = result.fetchedAt.slice(0, 10);
  const blob = new Blob([JSON.stringify(result)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `collected_${day}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  console.log(`→ collected_${day}.json 다운로드됨. Claude Project\\utilities\\bpm-assist-sync 폴더에 넣고 build_brand_types.py 실행`);
  window.__mipCollected = result; // 필요 시 콘솔에서 확인용
})();

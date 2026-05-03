export default async function handler(req, res) {
  const { lat, lng, lcls, mcls, budget, lawdCd } = req.query;
  const API_KEY = process.env.PUBLIC_API_KEY;

  try {
    // 1. 소상공인 상가 데이터 호출
    const bizUrl = `https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius?serviceKey=${API_KEY}&radius=500&cx=${lng}&cy=${lat}&type=json&indsLclsCd=${lcls || ''}&indsMclsCd=${mcls || ''}&numOfRows=100`;
    const bizRes = await fetch(bizUrl).catch(() => null);
    
    let bizCount = 0;
    if (bizRes && bizRes.ok) {
      const bizJson = await bizRes.json();
      bizCount = bizJson.body && bizJson.body.items ? bizJson.body.items.length : 0;
    }

    // 2. 국토부 실거래가 3년(36개월) 싹쓸이 탐색 (Vercel 타임아웃 방지용 병렬 청크 처리)
    let realEstatePyeongPrice = 0;
    let isRealData = false;

    // 6개월씩 6번(총 36개월) 탐색. 과거 데이터를 찾으면 즉시 중단하여 서버 부하 방지
    for (let chunk = 0; chunk < 6; chunk++) {
      if (isRealData) break; 
      
      const promises = [];
      for (let i = 1; i <= 6; i++) {
        const monthsAgo = chunk * 6 + i;
        const date = new Date();
        date.setMonth(date.getMonth() - monthsAgo);
        const dealYmd = date.getFullYear() + String(date.getMonth() + 1).padStart(2, '0');
        const molitUrl = `https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade?serviceKey=${API_KEY}&LAWD_CD=${lawdCd}&DEAL_YMD=${dealYmd}&numOfRows=50`;
        promises.push(fetch(molitUrl).then(r => r.text()).catch(() => null));
      }

      const results = await Promise.all(promises);
      
      for (const xmlText of results) {
        if (!xmlText) continue;
        const prices = [...xmlText.matchAll(/<거래금액>(.*?)<\/거래금액>/g)].map(m => parseInt(m[1].trim().replace(/,/g, '')));
        const areas = [...xmlText.matchAll(/<건물면적>(.*?)<\/건물면적>/g)].map(m => parseFloat(m[1].trim()));

        if (prices.length > 0 && areas.length > 0) {
          let totalPrice = 0, totalArea = 0;
          const len = Math.min(prices.length, areas.length);
          for(let j=0; j < len; j++) { totalPrice += prices[j]; totalArea += areas[j]; }
          if (totalArea > 0) {
            realEstatePyeongPrice = Math.round((totalPrice / totalArea) * 3.3058);
            isRealData = true;
            break; 
          }
        }
      }
    }

    // 3년(36개월)을 다 뒤져도 없으면 폴백
    if (!isRealData) realEstatePyeongPrice = 4500; 

    // 3. 생존 지표 계산
    const pyeong = 15;
    const monthlyRent = Math.round(((realEstatePyeongPrice * pyeong) * 0.05) / 12);
    const targetSales = monthlyRent * 10;
    
    // 업종별 대략적인 객단가 매핑
    let unitPrice = 10000;
    if (lcls === 'I' && mcls === 'I12') unitPrice = 4500; // 카페
    else if (lcls === 'I' && (mcls === 'I05' || mcls === 'I06')) unitPrice = 18000; // 치킨/패스트푸드
    else if (lcls === 'S' || lcls === 'P') unitPrice = 50000; // 미용실, 헬스장 등
    
    const customersNeededPerDay = Math.ceil((targetSales * 10000) / unitPrice / 30);

    // 4. 입지 점수
    let score = 100;
    if (bizCount > 30) score -= 30; else if (bizCount > 10) score -= 15;
    if (monthlyRent > 400) score -= 20; else if (monthlyRent > 200) score -= 10;
    if (bizCount <= 5 && monthlyRent > 0 && monthlyRent < 150) score += 15;
    const finalScore = Math.max(30, Math.min(score, 98));

    // 5. 팩트 폭격 코멘트
    let summary = "";
    let actionItems = [];

    if (!isRealData) {
      summary = "최근 3년 내 매매 내역이 없어 주변 평균가로 보정 분석했습니다.";
      actionItems.push("⚠️ 3년 넘게 상가 매매 거래가 없는 고인 상권이거나, 신도시일 수 있습니다.");
    } else if (bizCount > 20) {
      summary = `반경 내 동일 업종이 ${bizCount}개나 포진한 초경쟁 구역입니다.`;
      actionItems.push(`🔥 기존 ${bizCount}개 매장과 파이를 나눠 먹어야 합니다. 명확한 컨셉 차별화가 필수입니다.`);
    } else {
      summary = `경쟁 강도가 비교적 양호한 구역입니다. 배후 수요를 점검하세요.`;
      actionItems.push(`💡 주변에 대단지 아파트나 오피스 상주 인구가 충분한지 확인하세요.`);
    }

    actionItems.push(`💰 적자를 면하려면 매월 최소 <b>${targetSales.toLocaleString()}만 원</b>의 매출을 올려야 합니다.`);
    actionItems.push(`👥 객단가 ${unitPrice.toLocaleString()}원 기준, 하루 평균 <b>${customersNeededPerDay}명</b>의 결제가 필요합니다.`);

    const totalEstimatedCost = (monthlyRent * 12) + (pyeong * 200);
    if (parseInt(budget) < totalEstimatedCost) {
      actionItems.push(`🚨 입력하신 예산(${parseInt(budget).toLocaleString()}만 원)으로는 평균 초기 비용 감당이 위험합니다.`);
    }

    res.status(200).json({
      success: true,
      data: { isRealData: true, bizCount, realEstatePyeongPrice, monthlyRent, targetSales, customersNeededPerDay, unitPrice, score: finalScore, analysis: { summary, actionItems } }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

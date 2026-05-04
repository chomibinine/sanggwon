export default async function handler(req, res) {
  const { lat, lng, lcls, mcls, budget, lawdCd } = req.query;
  const API_KEY = process.env.PUBLIC_API_KEY;

  try {
    // 1. 소상공인 상가 데이터 호출 (반경 1000m, 최대 500건으로 확장)
    const bizUrl = `https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius?serviceKey=${API_KEY}&radius=1000&cx=${lng}&cy=${lat}&type=json&indsLclsCd=${lcls || ''}&indsMclsCd=${mcls || ''}&numOfRows=500`;
    const bizRes = await fetch(bizUrl).catch(() => null);
    
    let bizCount = 0;
    if (bizRes && bizRes.ok) {
      const bizJson = await bizRes.json();
      bizCount = bizJson.body && bizJson.body.items ? bizJson.body.items.length : 0;
    }

    // 2. 국토부 실거래가 3년(36개월) 싹쓸이 탐색 및 원본 데이터 보존
    let realEstatePyeongPrice = 0;
    let isRealData = false;
    let totalTradeCount = 0; 
    let sumTradePrice = 0;   
    let sumArea = 0;         

    for (let chunk = 0; chunk < 6; chunk++) {
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
          const len = Math.min(prices.length, areas.length);
          for(let j=0; j < len; j++) { 
            sumTradePrice += prices[j]; 
            sumArea += areas[j]; 
            totalTradeCount++;
          }
        }
      }
      if (totalTradeCount >= 3) break; 
    }

    // 통계 산출
    let avgArea = 0;
    let avgTradePrice = 0;

    if (totalTradeCount > 0 && sumArea > 0) {
      realEstatePyeongPrice = Math.round((sumTradePrice / sumArea) * 3.3058);
      avgArea = Math.round(sumArea / totalTradeCount);
      avgTradePrice = Math.round(sumTradePrice / totalTradeCount);
      isRealData = true;
    } else {
      realEstatePyeongPrice = 4500; // 폴백 시세
    }

    // 3. 생존 지표 계산
    const pyeong = 15;
    const monthlyRent = Math.round(((realEstatePyeongPrice * pyeong) * 0.05) / 12);
    const targetSales = monthlyRent * 10;
    
    let unitPrice = 10000;
    if (lcls === 'I' && mcls === 'I12') unitPrice = 4500; 
    else if (lcls === 'I' && (mcls === 'I05' || mcls === 'I06')) unitPrice = 18000; 
    else if (lcls === 'S' || lcls === 'P') unitPrice = 50000; 
    
    const customersNeededPerDay = Math.ceil((targetSales * 10000) / unitPrice / 30);

    // 4. 입지 점수 (반경이 넓어진 만큼 패널티 기준도 상향)
    let score = 100;
    if (bizCount > 50) score -= 30; else if (bizCount > 20) score -= 15;
    if (monthlyRent > 400) score -= 20; else if (monthlyRent > 200) score -= 10;
    if (bizCount <= 10 && monthlyRent > 0 && monthlyRent < 150) score += 15;
    const finalScore = Math.max(30, Math.min(score, 98));

    // 5. 팩트 폭격 코멘트
    let summary = "";
    let actionItems = [];

    if (!isRealData) {
      summary = "최근 3년 내 매매 내역이 없는 구역입니다.";
      actionItems.push("⚠️ 3년 넘게 상가 매매 거래가 없는 고인 상권이거나 신도시입니다. 권리금이 비정상적일 수 있습니다.");
    } else if (bizCount > 40) {
      summary = `반경 1km 내 ${bizCount}개의 매장이 피 터지게 싸우는 '초경쟁 구역'입니다.`;
      actionItems.push(`🔥 기존 매장들과 파이를 나눠 먹어야 합니다. '확실한 미끼 상품' 없이는 진입하지 마세요.`);
    } else {
      summary = `경쟁 강도는 무난합니다. 이제 '배후 수요'와 '임대료' 싸움입니다.`;
      actionItems.push(`💡 주변 1km 반경의 대단지 아파트나 오피스 상주 인구가 귀하의 타겟과 일치하는지 임장을 통해 확인하세요.`);
    }

    actionItems.push(`💰 이 상권의 평균 시세를 볼 때, 매월 최소 <b>${targetSales.toLocaleString()}만 원</b>을 팔아야 살아남습니다.`);
    actionItems.push(`👥 객단가 ${unitPrice.toLocaleString()}원 기준, 하루 평균 <b>${customersNeededPerDay}명</b>이 무조건 카드를 긁어야 유지됩니다.`);

    const totalEstimatedCost = (monthlyRent * 12) + (pyeong * 200);
    if (parseInt(budget) < totalEstimatedCost) {
      actionItems.push(`🚨 사장님의 예산(${parseInt(budget).toLocaleString()}만 원)으로는 이 반경 내 핵심 입지의 평균 초기 비용(약 ${totalEstimatedCost.toLocaleString()}만 원) 감당이 벅찹니다. 메인 도로 안쪽을 노려보세요.`);
    }

    res.status(200).json({
      success: true,
      data: { 
        isRealData, bizCount, realEstatePyeongPrice, monthlyRent, targetSales, customersNeededPerDay, unitPrice, score: finalScore,
        raw: { totalTradeCount, avgArea, avgTradePrice },
        analysis: { summary, actionItems } 
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export default async function handler(req, res) {
  const { lat, lng } = req.query;
  const API_KEY = process.env.PUBLIC_API_KEY;

  try {
    // 1. 소상공인 API 호출 (상가 수)
    const bizUrl = `https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInRadius?serviceKey=${API_KEY}&radius=500&cx=${lng}&cy=${lat}&type=json`;
    const bizRes = await fetch(bizUrl);
    const bizJson = await bizRes.json();
    const bizCount = bizJson.body ? bizJson.body.items.length : 0;

    // 2. 임대료 추정 로직 (국토부 데이터 연동 전 임시 난수)
    const realPrice = 3000 + Math.floor(Math.random() * 4000); // 3000 ~ 7000만 원

    // 🌟 3. 핵심: 입지 점수(ROI Score) 산출 알고리즘 🌟
    let score = 100;

    // 감점 1: 경쟁 강도 (상가가 너무 많으면 출혈 경쟁)
    // 상가 1개당 1.5점씩 감점, 최대 45점 감점
    const compPenalty = Math.min(bizCount * 1.5, 45);
    score -= compPenalty;

    // 감점 2: 고정비 리스크 (임대료가 너무 비싸면 BEP 달성 불가)
    let costPenalty = 0;
    if (realPrice > 6000) costPenalty = 30;      // S급 상권이지만 고위험
    else if (realPrice > 4500) costPenalty = 15; // A급 상권 (경쟁 치열)
    else costPenalty = 5;                        // B급 이하 (진입 용이)
    score -= costPenalty;

    // 가점: 블루오션 탐지 (경쟁은 적은데 임대료가 저렴한 꿀자리)
    if (bizCount > 0 && bizCount <= 10 && realPrice < 4000) {
      score += 20; 
    }

    // 최종 점수 보정 (최소 30점 ~ 최대 98점)
    const finalScore = Math.max(30, Math.min(Math.round(score), 98));

    // 4. 프론트로 데이터 쏘기
    res.status(200).json({
      bizCount,
      realPrice,
      score: finalScore, // 알고리즘 점수 추가
      source: "Vercel 서버리스 융합 분석",
    });

  } catch (e) {
    res.status(500).json({ error: "데이터 수집 실패" });
  }
}

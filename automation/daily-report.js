const { chromium } = require('playwright');
const https = require('https');

const CENTERS = [
  { name: '대전 둔산점', code: '23017000602' },
  { name: '대전 서구점', code: '23017000617' },
  { name: '천안 서북구점', code: '24413000644' },
  { name: '청주점', code: '24311001003' },
];

const SLACK_CHANNEL = 'C087JL55TA6';
const SLACK_TOKEN = (process.env.SLACK_BOT_TOKEN || '').trim();
const CAREFOR_BASIC_USER = process.env.CAREFOR_BASIC_USER || 'caring';
const CAREFOR_BASIC_PASS = process.env.CAREFOR_BASIC_PASS || 'zpdjfld2025072!';
const CAREFOR_LOGIN_ID = process.env.CAREFOR_LOGIN_ID || '관리자';
const CAREFOR_LOGIN_PASS = process.env.CAREFOR_LOGIN_PASS || 'zpdjfld1!';

const GOOGLE_SHEET_ID = '1Ns2HzBXbK2nCQuPhpO49KSr7Oyo5f5OgGLz4hvnueP8';

function getWeekdaysInMonth(year, month) {
  let count = 0;
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(year, month - 1, d).getDay();
    if (day >= 1 && day <= 5) count++;
  }
  return count;
}

function getTodayInfo() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const y = now.getFullYear();
  const month = now.getMonth() + 1;
  const m = String(month).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const weekdays = getWeekdaysInMonth(y, month);
  const stdHours = weekdays * 8;
  const driverStdHours = weekdays * 4;
  console.log(`[기준근무] ${y}년 ${m}월: 평일 ${weekdays}일 → 일반 ${stdHours}h / 운전사 ${driverStdHours}h`);
  return {
    dateStr: `${y}${m}${d}`,
    dateDisplay: `${y}년 ${m}월 ${d}일`,
    dayOfMonth: now.getDate(),
    stdHours,
    driverStdHours,
  };
}

function parseDailyModal(modalText) {
  const lines = modalText.split('\n').map(l => l.trim()).filter(l => l);
  const roles = ['시설장(관리책임자)', '사회복지사', '간호사', '간호조무사', '요양보호사', '사무원', '보조원(운전사)', '물리치료사', '대표자', '기타'];
  const categories = ['근무', '연차', '반차', '대체휴일', '공가', '결근', '조퇴', '지각', '외출'];
  const working = [];
  const leave = [];
  let cat = '', role = '', i = 0;

  while (i < lines.length && lines[i] !== '야간') i++;
  i++;

  while (i < lines.length) {
    if (/^[1-9]\d*$/.test(lines[i])) {
      i++;
      if (i >= lines.length) break;
      if (categories.includes(lines[i])) { cat = lines[i]; i++; }
      if (i < lines.length && roles.includes(lines[i])) { role = lines[i]; i++; }
      if (i >= lines.length) break;
      const name = lines[i]; i++;
      let time = i < lines.length ? lines[i] : ''; i++;
      while (i < lines.length && !/^[1-9]\d*$/.test(lines[i]) && lines[i] !== '엑셀 다운로드' && lines[i] !== '창닫기') i++;
      if (name === '엑셀 다운로드' || name === '창닫기') break;
      if (/^\d+$/.test(name)) continue;
      if (cat === '근무' || cat === '') working.push({ name, role, time });
      else leave.push({ name, role, type: cat, time });
    } else {
      i++;
    }
  }

  const unique = {};
  for (const w of working) {
    if (!unique[w.name]) unique[w.name] = w;
    else unique[w.name].time += ', ' + w.time;
  }
  return { working: Object.values(unique), leave };
}

async function collectCenterData(context, center, todayInfo) {
  const page = await context.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));

  try {
    await page.goto('https://eform.caring.co.kr/carefor', { waitUntil: 'domcontentloaded', timeout: 15000 });

    await page.evaluate(({ code, loginId, loginPass }) => {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = 'https://www.carefor.co.kr/exe/login_proc.php';
      for (const [k, v] of Object.entries({ rsmmgno: '', ctmnumb: code, stmiden: loginId, stmpass: loginPass, savecn: 'Y', saveid: 'Y' })) {
        const inp = document.createElement('input');
        inp.type = 'hidden'; inp.name = k; inp.value = v;
        form.appendChild(inp);
      }
      document.body.appendChild(form);
      form.submit();
    }, { code: center.code, loginId: CAREFOR_LOGIN_ID, loginPass: CAREFOR_LOGIN_PASS });

    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.evaluate(() => { document.getElementById('layerModal')?.style.setProperty('display', 'none'); });

    await page.evaluate(() => {
      document.querySelectorAll('li').forEach(item => {
        const s = item.querySelector('span');
        if (s && s.textContent.includes('8.직원관리')) item.click();
      });
    });
    await page.waitForTimeout(1000);

    await page.evaluate(() => { document.querySelectorAll('li[pamcode="L08_M02"]')[0]?.click(); });
    await page.waitForTimeout(5000);
    await page.evaluate(() => { document.getElementById('layerModal')?.style.setProperty('display', 'none'); });

    const staffData = await page.evaluate(() => {
      const t = document.getElementById('staff_list_table');
      if (!t) return { headers: [], rows: [] };
      const headers = Array.from(t.querySelectorAll('thead th, thead td')).map(h => h.textContent.trim());
      const rows = Array.from(t.querySelectorAll('tbody tr')).map(r => {
        const c = r.querySelectorAll('td');
        return Array.from(c).map(td => td.textContent.trim());
      });
      return { headers, rows };
    });

    console.log(`  [${center.name}] 테이블 헤더:`, JSON.stringify(staffData.headers));

    const hdrs = staffData.headers.map(h => h.replace(/\s+/g, ''));
    const stdIdx = hdrs.findIndex(h => h.includes('기준근무'));
    const whIdx = hdrs.findIndex(h => h.includes('공단근무인정') || h.includes('인정시간'));
    const nameIdx = hdrs.findIndex(h => h.includes('직원명') || h.includes('이름'));
    const roleIdx = hdrs.findIndex(h => h.includes('담당직종') || h.includes('직종'));
    const noIdx = hdrs.findIndex(h => h.includes('번호'));

    console.log(`  [${center.name}] 컬럼 인덱스 — 번호:${noIdx} 이름:${nameIdx} 직종:${roleIdx} 기준근무:${stdIdx} 공단시간:${whIdx}`);

    const parsedStaff = staffData.rows.map(cols => {
      const no = cols[noIdx >= 0 ? noIdx : 1];
      if (!no || isNaN(parseInt(no))) return null;
      const name = cols[nameIdx >= 0 ? nameIdx : 2];
      const role = cols[roleIdx >= 0 ? roleIdx : 3];
      const wh = parseFloat(cols[whIdx >= 0 ? whIdx : 5]) || 0;
      const std = stdIdx >= 0 ? (parseFloat(cols[stdIdx]) || 0) : 0;
      const drv = role.includes('운전사');
      const overtime = std > 0 ? Math.round((wh - std) * 10) / 10 : Math.round((wh - (drv ? todayInfo.driverStdHours : todayInfo.stdHours)) * 10) / 10;
      return { name, role, workHours: wh, isDriver: drv, overtime, stdHours: std };
    }).filter(Boolean);

    await page.evaluate((ds) => {
      const cell = document.getElementById('staffWorkPlanCalendarTbl')?.querySelector(`td[data-key="${ds}"]`);
      if (cell) {
        const span = cell.querySelector('.date_area');
        if (span) open_work_plan_all($(span));
      }
    }, todayInfo.dateStr);
    await page.waitForTimeout(3000);

    const modalText = await page.evaluate(() => document.getElementById('layerModal')?.innerText || '');
    const dailyStaff = parseDailyModal(modalText);

    await page.close();
    return { center: center.name, staffData: parsedStaff, dailyStaff };
  } catch (e) {
    console.error(`[${center.name}] Error:`, e.message);
    await page.close().catch(() => {});
    return { center: center.name, staffData: [], dailyStaff: { working: [], leave: [] }, error: e.message };
  }
}

function slackPost(method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'slack.com',
      path: `/api/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${SLACK_TOKEN}`,
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function formatMainMessage(dateDisplay, results) {
  let totalWorking = 0, totalAll = 0;
  const sections = results.map(r => {
    const workCount = r.dailyStaff.working.length;
    const total = r.staffData.length;
    totalWorking += workCount;
    totalAll += total;

    const leaveCount = r.dailyStaff.leave.length;
    const leaveTypes = {};
    r.dailyStaff.leave.forEach(l => { leaveTypes[l.type] = (leaveTypes[l.type] || 0) + 1; });
    const leaveStr = Object.entries(leaveTypes).map(([t, c]) => `${t} ${c}명`).join(', ');

    const overtime = r.staffData.filter(s => s.overtime > 0 && !s.isDriver);
    const otTotal = overtime.reduce((sum, s) => sum + s.overtime, 0);
    const otDetail = overtime.sort((a, b) => b.overtime - a.overtime).map(s => `${s.name} ${s.overtime}h`).join(', ');

    const drivers = r.staffData.filter(s => s.isDriver);
    const drvStr = drivers.map(d => `${d.name} ${d.workHours}h${d.overtime > 0 ? ` (추가 ${d.overtime}h)` : ''}`).join(' / ');

    let line = `*🏢 ${r.center}*\n`;
    line += `• 당일 근무: *${workCount}명* / 총 ${total}명`;
    if (leaveCount > 0) line += ` (${leaveStr})`;
    line += '\n';
    line += `• 추가근무시간: *${otTotal}h*`;
    if (otDetail) line += ` (${otDetail})`;
    line += '\n';
    line += `• 🚗 운전사: ${drvStr || '없음'}`;
    return line;
  });

  return `📋 *충청본부 근무일정 현황* (${dateDisplay})\n\n━━━━━━━━━━━━━━━━━━━━━━\n\n${sections.join('\n\n')}\n\n━━━━━━━━━━━━━━━━━━━━━━\n*충청본부 합계: 당일 근무 ${totalWorking}명 / 총 ${totalAll}명*\n💡 _상세 근무자 명단은 아래 스레드를 확인하세요_`;
}

function formatThreadMessage(r) {
  const rows = r.dailyStaff.working.map(w => `| ${w.role} | ${w.name} | ${w.time} |`).join('\n');
  let msg = `*📌 ${r.center} — 근무자 명단 (${r.dailyStaff.working.length}명)*\n\n| 직종 | 직원명 | 근무시간 |\n|------|--------|----------|\n${rows}`;

  if (r.dailyStaff.leave.length > 0) {
    const leaveList = r.dailyStaff.leave.map(l => `${l.name}(${l.type})`).join(', ');
    msg += `\n\n> 🏖️ *휴가:* ${leaveList}`;
  } else {
    msg += '\n\n> _휴가 없음_';
  }
  return msg;
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve(raw));
    }).on('error', reject);
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; }
    else if (line[i] === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += line[i]; }
  }
  result.push(current.trim());
  return result;
}

async function collectGoogleSheetData(todayInfo) {
  console.log('  [방문요양대전점] 구글시트 수집 중...');
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const monthNum = now.getMonth() + 1;
  const sheetName = `${monthNum}월`;
  console.log(`  [방문요양대전점] ${sheetName} 탭 조회`);
  const url = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  try {
    const csv = await fetchUrl(url);
    const rows = csv.split('\n').filter(r => r.trim());
    const header = parseCSVLine(rows[0]);
    const dayCol = header.indexOf(String(todayInfo.dayOfMonth));
    if (dayCol === -1) {
      console.error('  [방문요양대전점] 오늘 날짜 열을 찾을 수 없음');
      return null;
    }

    const working = [], leave = [];
    const staffData = [];
    const leaveTypes = ['연차', '반차', '대체휴무', '대체휴일', '공가', '결근'];

    for (let i = 1; i < rows.length; i++) {
      const cols = parseCSVLine(rows[i]);
      const name = cols[0];
      if (!name) continue;

      const role = cols[1] || '';
      const stdHours = parseFloat(cols[2]) || todayInfo.stdHours;
      const overtimeHours = parseFloat(cols[3]) || 0;
      const isDriver = role.includes('운전사');
      const todayVal = (cols[dayCol] || '').trim();

      staffData.push({ name, role, workHours: stdHours + overtimeHours, isDriver, overtime: overtimeHours });

      if (!todayVal) continue;
      if (leaveTypes.some(t => todayVal.includes(t))) {
        leave.push({ name, role, type: todayVal, time: '' });
      } else {
        working.push({ name, role, time: todayVal });
      }
    }

    console.log(`  [방문요양대전점] 근무 ${working.length}명, 휴가 ${leave.length}명`);
    return {
      center: '방문요양대전점',
      staffData,
      dailyStaff: { working, leave },
    };
  } catch (e) {
    console.error('  [방문요양대전점] Error:', e.message);
    return null;
  }
}

async function main() {
  if (!SLACK_TOKEN) {
    console.error('SLACK_BOT_TOKEN 환경변수가 설정되지 않았습니다.');
    process.exit(1);
  }

  const todayInfo = getTodayInfo();
  console.log(`[${todayInfo.dateDisplay}] 근무일정 수집 시작...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    httpCredentials: { username: CAREFOR_BASIC_USER, password: CAREFOR_BASIC_PASS },
  });

  const results = [];
  for (const center of CENTERS) {
    console.log(`  [${center.name}] 수집 중...`);
    const data = await collectCenterData(context, center, todayInfo);
    results.push({
      center: data.center,
      staffData: data.staffData,
      dailyStaff: data.dailyStaff,
    });
    console.log(`  [${center.name}] 근무 ${data.dailyStaff.working.length}명, 휴가 ${data.dailyStaff.leave.length}명`);
  }

  await browser.close();

  const sheetData = await collectGoogleSheetData(todayInfo);
  if (sheetData) results.push(sheetData);

  const mainMsg = formatMainMessage(todayInfo.dateDisplay, results);
  console.log('\nSlack 메인 메시지 전송 중...');
  const mainRes = await slackPost('chat.postMessage', { channel: SLACK_CHANNEL, text: mainMsg });

  if (!mainRes.ok) {
    console.error('메인 메시지 전송 실패:', mainRes.error);
    process.exit(1);
  }
  console.log('메인 메시지 전송 완료');

  const threadTs = mainRes.ts;
  for (const r of results) {
    const threadMsg = formatThreadMessage(r);
    const threadRes = await slackPost('chat.postMessage', { channel: SLACK_CHANNEL, text: threadMsg, thread_ts: threadTs });
    if (threadRes.ok) console.log(`  [${r.center}] 스레드 전송 완료`);
    else console.error(`  [${r.center}] 스레드 전송 실패:`, threadRes.error);
  }

  console.log('\n완료!');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

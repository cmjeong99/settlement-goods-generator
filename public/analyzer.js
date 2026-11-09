import { extract, canonical, walk, lineAt } from './parser.js';
import { FIELDS } from './domain.js';
import { pairUpdates } from './update-pairs.js';
const call = (n, name) => n?.kind === 'call' && n.name === name;
const num = (n, v) => n?.kind === 'number' && Number(n.value) === v;
const numeric = (n) =>
  n?.kind === 'unary' && ['-', '+'].includes(n.op)
    ? (n.op === '-' ? -1 : 1) * numeric(n.arg)
    : n?.kind === 'number'
      ? Number(n.value)
      : NaN;
const id = (n, re) => n?.kind === 'id' && re.test(n.name.split('.').at(-1));
const same = (a, b) => !!a && !!b && canonical(a) === canonical(b);
const has = (n, name) => walk(n, (x) => call(x, name));
const isRate = (n) => id(n, /^(?:[A-Z_]*RATE|R)$/);
const isFeeRef = (n) => id(n, /^(CPFEE|RAMT)$/);
const roundingNames = ['FLOOR', 'CEILING', 'ROUND'];
const rounding = (n) => n?.kind === 'call' && roundingNames.includes(n.name);
function signSource(n) {
  if (call(n, 'SIGN')) return n.args[0];
  if (
    n?.kind === 'case' &&
    !n.base &&
    n.branches.length === 1 &&
    numeric(n.branches[0].then) === -1 &&
    num(n.otherwise, 1)
  ) {
    const w = n.branches[0].when;
    if (w.kind === 'binary' && w.op === '<' && num(w.right, 0)) return w.left;
  }
  if (n?.kind === 'binary' && n.op === '/' && call(n.right, 'ABS') && same(n.left, n.right.args[0]))
    return n.left;
  return null;
}
function stripSign(n) {
  if (n?.kind === 'binary' && n.op === '*') {
    if (signSource(n.right)) return { core: n.left, sign: signSource(n.right), position: 'AFTER' };
    if (signSource(n.left)) return { core: n.right, sign: signSource(n.left), position: 'AFTER' };
  }
  // SQL precedence: expression * AMT / ABS(AMT)
  if (
    n?.kind === 'binary' &&
    n.op === '/' &&
    call(n.right, 'ABS') &&
    n.left.kind === 'binary' &&
    n.left.op === '*' &&
    same(n.left.right, n.right.args[0])
  )
    return { core: n.left.left, sign: n.left.right, position: 'AFTER' };
  if (rounding(n)) {
    const inner = stripSign(n.args[0]);
    if (inner.sign)
      return {
        core: { ...n, args: [inner.core, ...n.args.slice(1)] },
        sign: inner.sign,
        position: 'BEFORE',
      };
  }
  return { core: n, sign: null, position: null };
}
function nonnegative(n) {
  if (call(n, 'ABS') || isRate(n)) return true;
  if (Number.isFinite(numeric(n))) return numeric(n) >= 0;
  if (n?.kind === 'binary' && ['*', '/', '+'].includes(n.op))
    return nonnegative(n.left) && nonnegative(n.right);
  if (n?.kind === 'call' && ['ISNULL', 'COALESCE'].includes(n.name))
    return n.args.every(nonnegative);
  if (call(n, 'COUNT')) return true;
  if (call(n, 'SUM') || call(n, 'NULLIF')) return nonnegative(n.args[0]);
  if (rounding(n)) return nonnegative(n.args[0]);
  return false;
}
function scaledRound(n) {
  if (n?.kind !== 'binary') return null;
  let node, factor;
  if (n.op === '*') {
    if (rounding(n.left)) {
      node = n.left;
      factor = numeric(n.right);
    } else if (rounding(n.right)) {
      node = n.right;
      factor = numeric(n.left);
    }
  } else if (n.op === '/' && rounding(n.left)) {
    node = n.left;
    factor = 1 / numeric(n.right);
  }
  if (
    !node ||
    !Number.isFinite(factor) ||
    factor < 1e-12 ||
    factor > 1e12 ||
    Math.abs(Math.log10(factor) - Math.round(Math.log10(factor))) > 1e-10
  )
    return null;
  const inner = node.args[0];
  if (inner?.kind === 'binary' && inner.op === '/' && numeric(inner.right) === factor)
    return { node, input: inner.left, factor };
  if (inner?.kind === 'binary' && inner.op === '*') {
    if (numeric(inner.right) === 1 / factor) return { node, input: inner.left, factor };
    if (numeric(inner.left) === 1 / factor) return { node, input: inner.right, factor };
  }
  return null;
}
function roundInfo(n) {
  let core = n,
    base = has(n, 'SUM') || has(n, 'COUNT') ? 'SUM' : 'EACH';
  if (call(core, 'SUM')) {
    core = core.args[0];
    if (rounding(core) || scaledRound(core)) base = 'EACH';
  }
  const scaled = scaledRound(core);
  if (scaled) core = scaled.node;
  if (!rounding(core)) return { base, method: 'NONE', unit: null, input: core };
  const input = scaled?.input ?? core.args[0],
    factor = scaled?.factor ?? 1;
  if (core.name === 'ROUND') {
    const digits = numeric(core.args[1]),
      truncate = core.args[2] ? numeric(core.args[2]) : 0;
    if (!Number.isInteger(digits) || Math.abs(digits) > 12 || !Number.isFinite(truncate))
      return { base, method: null, unit: null, input: core.args[0] };
    const unit = 10 ** (Math.round(Math.log10(factor)) - digits);
    if (unit < 1e-12 || unit > 1e12) return { base, method: null, unit: null, input };
    return {
      base,
      method: truncate === 0 ? 'HALF_UP' : 'DOWN',
      unit: unit === 1 ? 0 : unit,
      input,
    };
  }
  return {
    base,
    method:
      core.name === 'FLOOR' ? (nonnegative(core.args[0]) ? 'DOWN' : 'SIGNED_DOWN') : 'CEILING',
    unit: factor === 1 ? 0 : factor,
    input,
  };
}
function positiveConstant(n) {
  const value = call(n, 'NULLIF') && num(n.args[1], 0) ? numeric(n.args[0]) : numeric(n);
  return Number.isFinite(value) && value > 0;
}
function rateFactor(n) {
  if (isRate(n)) return true;
  if (n?.kind === 'binary' && n.op === '/' && positiveConstant(n.right)) return rateFactor(n.left);
  if (n?.kind === 'binary' && n.op === '*')
    return (
      (positiveConstant(n.left) && rateFactor(n.right)) ||
      (positiveConstant(n.right) && rateFactor(n.left))
    );
  return false;
}
function rateProduct(n) {
  if (n?.kind === 'binary' && n.op === '*')
    return rateFactor(n.left) || rateFactor(n.right) || rateProduct(n.left) || rateProduct(n.right);
  if (n?.kind === 'binary' && n.op === '/' && positiveConstant(n.right)) return rateProduct(n.left);
  if (
    n?.kind === 'call' &&
    ['ABS', 'FLOOR', 'CEILING', 'ROUND', 'SUM', 'CAST', 'CONVERT'].includes(n.name)
  )
    return rateProduct(n.args[0]);
  if (
    n?.kind === 'call' &&
    ['ISNULL', 'COALESCE'].includes(n.name) &&
    n.args.slice(1).every((arg) => num(arg, 0))
  )
    return rateProduct(n.args[0]);
  return false;
}
function vatBase(n) {
  if (n?.kind === 'binary' && n.op === '*') {
    if (num(n.left, 0.1)) return n.right;
    if (num(n.right, 0.1)) return n.left;
  }
  if (n?.kind === 'binary' && n.op === '/' && num(n.right, 10)) return n.left;
  // Preserve the order of arithmetic: do not cancel integer divisions.
  if (
    n?.kind === 'binary' &&
    n.op === '/' &&
    num(n.right, 100) &&
    n.left.kind === 'binary' &&
    n.left.op === '*'
  ) {
    if (num(n.left.right, 10)) return n.left.left;
    if (num(n.left.left, 10)) return n.left.right;
  }
  return null;
}
const supported = new Set([
  'ABS',
  'SIGN',
  'FLOOR',
  'CEILING',
  'ROUND',
  'SUM',
  'COUNT',
  'CAST',
  'CONVERT',
  'ISNULL',
  'COALESCE',
  'NULLIF',
]);
export function analyzeBlock(block, source, options = {}) {
  const fields = Object.fromEntries(
    FIELDS.map(([key]) => [
      key,
      {
        value: null,
        status: 'unknown',
        source: 'parser',
        reason: '수식에서 확인할 수 없어요.',
        evidence: [],
      },
    ]),
  );
  const notices = block.errors.map((e) => `${lineAt(source, e.offset)}행: ${e.message}`);
  function put(key, value, node, reason, status = 'known') {
    if (value === null && status === 'known') status = 'unknown';
    fields[key] = {
      value,
      status,
      source: 'parser',
      reason,
      evidence: node
        ? [
            {
              start: node.start,
              end: node.end,
              line: lineAt(source, node.start),
              endLine: lineAt(source, node.end),
              text: source.slice(node.start, node.end),
            },
          ]
        : [],
    };
  }
  function custom(keys, node, reason) {
    keys.forEach((k) => put(k, null, node, reason, 'custom'));
    notices.push(reason);
  }
  const fee = block.formulas.fee,
    vat = block.formulas.vat;
  const fs = stripSign(fee),
    vs = stripSign(vat),
    f = fs.core,
    v = vs.core;
  const feeKeys = ['FEE_SMT_CALC_BASE_DVCD', 'FEE_SMT_CALC_MHOD_DVCD', 'FEE_SMT_CALC_UNIT_VAL'];
  const vatKeys = [
    'VAT_CALC_TRGT_DVCD',
    'VAT_SMT_CALC_BASE_DVCD',
    'VAT_SMT_CALC_MHOD_DVCD',
    'VAT_SMT_CALC_UNIT_VAL',
  ];
  function setRounding(keys, node, original) {
    const ri = roundInfo(node);
    // BigDecimal.DOWN truncates toward zero. SQL FLOOR on a signed value does not.
    const outer = call(node, 'SUM') ? node.args[0] : node;
    if (
      (call(outer, 'FLOOR') || call(scaledRound(outer)?.node, 'FLOOR')) &&
      stripSign(original).position === 'BEFORE'
    )
      ri.method = 'SIGNED_DOWN';
    put(
      keys[0],
      ri.base,
      original,
      ri.base === 'SUM'
        ? '합산한 금액·건수로 계산해요.'
        : '건별로 계산해요. 바깥 SUM은 계산 결과를 더해요.',
    );
    if (ri.method) {
      put(keys[1], ri.method, original, '가장 바깥쪽 반올림·절사·올림 함수가 기준이에요.');
      if (ri.unit !== null)
        put(
          keys[2],
          ri.unit,
          original,
          '단위 코드: 1원은 0, 10원은 10, 소수 둘째 자리는 0.01이에요.',
        );
      else
        put(
          keys[2],
          null,
          original,
          '반올림·절사·올림이 없어 계산 단위를 적용하지 않아요.',
          'not-applicable',
        );
    }
    return ri;
  }
  if (f) {
    const ri = setRounding(feeKeys, f, fee);
    const conditional = walk(
      f,
      (n) => n.kind === 'case' || (n.kind === 'call' && !supported.has(n.name)),
    );
    if (!conditional) {
      if (rateProduct(f)) {
        put('FEE_TYPE_DVCD', 'RATE', fee, '금액에 요율을 곱해요.');
        put('FRIM_BASE_DVCD', 'AMOUNT', fee, '요율을 곱하는 금액이 기준이에요.');
      } else if (
        walk(f, (n) => id(n, /^(AUTHRATE|CPRATE2|COST|BASIC_COST|EXCESS_COST)$/)) ||
        f.kind === 'number'
      )
        put('FEE_TYPE_DVCD', 'FIXED', fee, '정액 단가를 사용해요. 건수 종류는 따로 확인해 주세요.');
      if (has(f, 'COUNT')) {
        put('FEE_TYPE_DVCD', 'FIXED', fee, '합산한 건수에 단가를 적용해요.');
        put(
          'FRIM_BASE_DVCD',
          null,
          fee,
          'COUNT만으로는 성공 건수와 시도 건수를 구분할 수 없어요.',
          'unknown',
        );
      }
    }
    if (conditional || (ri.input && walk(ri.input, rounding)))
      custom(feeKeys, f, '조건부·다단계 수수료 계산은 하나의 상품 설정으로 표현할 수 없어요.');
  }
  if (v) {
    const ri = setRounding(vatKeys.slice(1), v, vat);
    const base = vatBase(ri.input);
    if (num(v, 0)) {
      put('VAT_DVCD', 'ZERO', vat, '부가세가 상수 0이에요.');
      put('VAT_CALC_TRGT_DVCD', 'NONE', vat, '부가세 계산 대상이 없어요.');
      put('VAT_SMT_CALC_MHOD_DVCD', 'NONE', vat, '부가세를 계산하지 않아요.');
      put(
        'VAT_SMT_CALC_UNIT_VAL',
        null,
        vat,
        '부가세 계산 단위를 적용하지 않아요.',
        'not-applicable',
      );
    } else if (base) {
      put('VAT_DVCD', 'SEPARATED', vat, '기준액의 10%를 별도 부가세로 계산해요.');
      if (same(base, f))
        put(
          'VAT_CALC_TRGT_DVCD',
          'FEE',
          vat,
          '부가세 기준액이 반올림·절사·올림을 포함한 수수료 식과 같아요.',
        );
      else if (walk(base, isFeeRef)) {
        put(
          'VAT_CALC_TRGT_DVCD',
          null,
          vat,
          'CPFEE/RAMT의 계산 시점을 확인해 주세요. 같은 UPDATE의 우변은 갱신 전 값이에요.',
        );
        notices.push('수수료 컬럼 참조의 갱신 순서·조회 원천을 확인해 주세요.');
      } else if (rateProduct(base) && !walk(base, rounding))
        put('VAT_CALC_TRGT_DVCD', 'AMOUNT', vat, '반올림 전 금액×요율에 부가세율을 적용해요.');
    }
    if (
      !num(v, 0) &&
      (!base ||
        walk(v, (n) => n.kind === 'case') ||
        walk(v, (n) => n.kind === 'call' && !supported.has(n.name)))
    )
      custom(
        vatKeys,
        vat,
        '부가세 차감식·조건식·미지원 함수는 별도 계산이 필요해요. 원문을 확인해 주세요.',
      );
  }
  const formulas = [fee, vat].filter(Boolean);
  if (formulas.length) {
    // 상수 0은 절대값 처리나 부호 재적용 여부에 영향을 주지 않는다.
    const active = formulas.filter((n) => !num(stripSign(n).core, 0));
    const signs = active.map(stripSign);
    const unsigned = signs.length > 0 && signs.every((x) => !x.sign && nonnegative(x.core));
    const abs = (active.length ? active : formulas).map((n) => has(n, 'ABS'));
    if (unsigned && abs.every((x) => !x) && fields.FEE_TYPE_DVCD.value === 'FIXED')
      put(
        'ABS_PROCS_YN',
        'Y',
        fee ?? vat,
        '정액 단가의 양수 결과를 유지하도록 Y/NONE으로 설정해요. 거래금액은 단가 계산에 사용하지 않아요.',
      );
    else if (abs.every(Boolean))
      put('ABS_PROCS_YN', 'Y', fee ?? vat, '입력한 수수료·부가세 식에서 ABS를 사용해요.');
    else if (abs.every((x) => !x))
      put('ABS_PROCS_YN', 'N', fee ?? vat, '입력한 식에 ABS가 없어요.');
    else
      custom(
        ['ABS_PROCS_YN'],
        fee ?? vat,
        '수수료와 부가세의 절대값 처리가 달라 공통 설정을 정할 수 없어요.',
      );
    if (
      signs.length &&
      signs.every((x) => x.sign) &&
      new Set(signs.map((x) => x.position)).size === 1 &&
      signs.every((x) => same(x.sign, signs[0].sign))
    )
      put(
        'SIGN_APLY_LOCT_DVCD',
        signs[0].position,
        fee ?? vat,
        '반올림·절사·올림 전후의 부호 적용 위치가 기준이에요.',
      );
    else if (unsigned && fields.ABS_PROCS_YN.value === 'Y')
      put(
        'SIGN_APLY_LOCT_DVCD',
        'NONE',
        fee ?? vat,
        '수수료·부가세를 양수로 계산하고 원래 거래금액의 부호를 다시 붙이지 않아요. 단수 처리는 그대로 적용해요.',
      );
    if (formulas.some((n) => has(n, 'CAST') || has(n, 'CONVERT'))) {
      notices.push(
        'CAST/CONVERT 타입 변환이 있어요. 원천 타입과 변환 시 절사·반올림을 확인해 주세요.',
      );
    }
    if (formulas.some((n) => walk(n, (x) => x.kind === 'binary' && x.op === '/')))
      notices.push(
        '정수 나눗셈은 5 ÷ 2가 2로 계산될 수 있어요. 소수점 결과와 0으로 나누는 경우를 확인해 주세요.',
      );
    if (formulas.some((n) => has(n, 'NULLIF') || has(n, 'ISNULL') || has(n, 'COALESCE')))
      notices.push(
        'NULL 처리 함수가 있어요. 실제 NULL 발생 여부와 대체값의 업무 의미를 확인해 주세요.',
      );
  }
  if (options.inputScope === 'settlement' && !block.errors.length) {
    for (const key of ['FEE_SMT_CALC_BASE_DVCD', 'VAT_SMT_CALC_BASE_DVCD']) {
      if (fields[key].status !== 'known') continue;
      fields[key] = {
        ...fields[key],
        value: 'SUM',
        source: 'context',
        reason: 'AMT는 가맹점·정산주기별로 이미 합산된 금액이라는 입력 기준을 반영했어요.',
      };
    }
  }
  if (block.errors.length) {
    for (const key of Object.keys(fields))
      put(
        key,
        null,
        null,
        '불완전하거나 중복된 계산식이에요. 구문 오류를 고친 뒤 다시 분석해 주세요.',
        'unknown',
      );
  }
  const result = {
    id: block.id,
    line: block.line,
    sql: block.sql,
    fields,
    notices: [...new Set(notices)],
    formulas: block.formulas,
    inputScope: options.inputScope ?? 'row',
    ...(block.statements ? { statements: block.statements } : {}),
  };
  result.summary = summarize(result);
  return result;
}
export function summarize(result) {
  const val = (k) => result.fields[k]?.value;
  const names = {
    EACH: '건별',
    SUM: '합산',
    RATE: '정률',
    FIXED: '정액',
    HALF_UP: '반올림',
    DOWN: '절사',
    CEILING: '올림',
    HALF_DOWN: 'HALF_DOWN',
    NONE: '미적용',
    SIGNED_DOWN: '부호별 절사',
  };
  const fee = [
    names[val('FEE_SMT_CALC_BASE_DVCD')],
    names[val('FEE_TYPE_DVCD')],
    names[val('FEE_SMT_CALC_MHOD_DVCD')],
  ]
    .filter(Boolean)
    .join(' ');
  const vat =
    val('VAT_DVCD') === 'ZERO'
      ? 'VAT 0'
      : `${val('VAT_CALC_TRGT_DVCD') === 'FEE' ? '계산된 수수료' : val('VAT_CALC_TRGT_DVCD') === 'AMOUNT' ? '금액×요율' : '대상 미확정'} 기준 VAT ${names[val('VAT_SMT_CALC_MHOD_DVCD')] ?? '별도 확인'}`;
  return [fee || '수수료 미확정', vat].join(' · ');
}
export function analyze(source, options = {}) {
  if (typeof source !== 'string' || !source.trim())
    return { results: [], errors: ['수수료·부가세 수식을 입력해 주세요.'] };
  if (source.length > 100000)
    return { results: [], errors: ['입력은 100,000자 이하로 나눠 주세요.'] };
  try {
    if (options?.inputScope !== undefined && !['row', 'settlement'].includes(options.inputScope))
      throw new Error('입력 금액의 기준을 확인해 주세요.');
    const results = pairUpdates(extract(source, options), source).map((block) =>
      analyzeBlock(block, source, options),
    );
    return {
      results,
      errors: results.length
        ? []
        : ['수수료·부가세 계산식을 찾지 못했어요. ‘결과 컬럼 지정’에서 컬럼명을 확인해 주세요.'],
    };
  } catch (e) {
    return { results: [], errors: [`${lineAt(source, e.offset ?? 0)}행: ${e.message}`] };
  }
}

export const TAIWAN_INSURANCE_BASELINE_EFFECTIVE_FROM = '2026-01-01'

export const TAIWAN_INSURANCE_SOURCES = Object.freeze({
  laborInsurance: 'https://www.bli.gov.tw/0103175.html',
  healthInsurance: 'https://www.nhi.gov.tw/ch/cp-19418-9eefb-2576-1.html',
  laborPension: 'https://www.bli.gov.tw/0013083.html',
})

export const DEFAULT_LABOR_INSURANCE_RATES = [
  { level: 1, insuredSalary: 11100, workerFee: 277, employerFee: 972 },
  { level: 2, insuredSalary: 12540, workerFee: 313, employerFee: 1097 },
  { level: 3, insuredSalary: 13500, workerFee: 338, employerFee: 1182 },
  { level: 4, insuredSalary: 15840, workerFee: 396, employerFee: 1386 },
  { level: 5, insuredSalary: 16500, workerFee: 413, employerFee: 1444 },
  { level: 6, insuredSalary: 17280, workerFee: 432, employerFee: 1512 },
  { level: 7, insuredSalary: 17880, workerFee: 447, employerFee: 1564 },
  { level: 8, insuredSalary: 19047, workerFee: 476, employerFee: 1666 },
  { level: 9, insuredSalary: 20008, workerFee: 500, employerFee: 1751 },
  { level: 10, insuredSalary: 21009, workerFee: 525, employerFee: 1838 },
  { level: 11, insuredSalary: 22000, workerFee: 550, employerFee: 1925 },
  { level: 12, insuredSalary: 23100, workerFee: 577, employerFee: 2022 },
  { level: 13, insuredSalary: 24000, workerFee: 600, employerFee: 2100 },
  { level: 14, insuredSalary: 25250, workerFee: 632, employerFee: 2210 },
  { level: 15, insuredSalary: 26400, workerFee: 660, employerFee: 2310 },
  { level: 16, insuredSalary: 27600, workerFee: 690, employerFee: 2415 },
  { level: 17, insuredSalary: 28590, workerFee: 715, employerFee: 2501 },
  { level: 18, insuredSalary: 29500, workerFee: 738, employerFee: 2582 },
  { level: 19, insuredSalary: 30300, workerFee: 758, employerFee: 2651 },
  { level: 20, insuredSalary: 31800, workerFee: 795, employerFee: 2783 },
  { level: 21, insuredSalary: 33300, workerFee: 833, employerFee: 2914 },
  { level: 22, insuredSalary: 34800, workerFee: 870, employerFee: 3045 },
  { level: 23, insuredSalary: 36300, workerFee: 908, employerFee: 3176 },
  { level: 24, insuredSalary: 38200, workerFee: 955, employerFee: 3342 },
  { level: 25, insuredSalary: 40100, workerFee: 1002, employerFee: 3509 },
  { level: 26, insuredSalary: 42000, workerFee: 1050, employerFee: 3675 },
  { level: 27, insuredSalary: 43900, workerFee: 1098, employerFee: 3841 },
  { level: 28, insuredSalary: 45800, workerFee: 1145, employerFee: 4008 },
]

const HEALTH_INSURANCE_ROWS = [
  [29500, 458, 1428], [30300, 470, 1466], [31800, 493, 1539],
  [33300, 516, 1611], [34800, 540, 1684], [36300, 563, 1757],
  [38200, 592, 1849], [40100, 622, 1940], [42000, 651, 2032],
  [43900, 681, 2124], [45800, 710, 2216], [48200, 748, 2332],
  [50600, 785, 2449], [53000, 822, 2565], [55400, 859, 2681],
  [57800, 896, 2797], [60800, 943, 2942], [63800, 990, 3087],
  [66800, 1036, 3233], [69800, 1083, 3378], [72800, 1129, 3523],
  [76500, 1187, 3702], [80200, 1244, 3881], [83900, 1301, 4060],
  [87600, 1359, 4239], [92100, 1428, 4457], [96600, 1498, 4675],
  [101100, 1568, 4892], [105600, 1638, 5110], [110100, 1708, 5328],
  [115500, 1791, 5589], [120900, 1875, 5850], [126300, 1959, 6112],
  [131700, 2043, 6373], [137100, 2126, 6634], [142500, 2210, 6896],
  [147900, 2294, 7157], [150000, 2327, 7259], [156400, 2426, 7568],
  [162800, 2525, 7878], [169200, 2624, 8188], [175600, 2724, 8497],
  [182000, 2823, 8807], [189500, 2939, 9170], [197000, 3055, 9533],
  [204500, 3172, 9896], [212000, 3288, 10259], [219500, 3404, 10622],
  [228200, 3539, 11043], [236900, 3674, 11464], [245600, 3809, 11885],
  [254300, 3944, 12306], [263000, 4079, 12727], [273000, 4234, 13211],
  [283000, 4389, 13695], [293000, 4544, 14179], [303000, 4700, 14663],
  [313000, 4855, 15146],
]

export const DEFAULT_HEALTH_INSURANCE_RATES = HEALTH_INSURANCE_ROWS.map(
  ([insuredSalary, workerFee, employerFee], index) => ({
    level: index + 1,
    insuredSalary,
    workerFee,
    employerFee,
  })
)

const LABOR_PENSION_SALARIES = [
  1500, 3000, 4500, 6000, 7500, 8700, 9900, 11100, 12540, 13500,
  15840, 16500, 17280, 17880, 19047, 20008, 21009, 22000, 23100,
  24000, 25250, 26400, 27600, 28590, 29500, 30300, 31800, 33300,
  34800, 36300, 38200, 40100, 42000, 43900, 45800, 48200, 50600,
  53000, 55400, 57800, 60800, 63800, 66800, 69800, 72800, 76500,
  80200, 83900, 87600, 92100, 96600, 101100, 105600, 110100, 115500,
  120900, 126300, 131700, 137100, 142500, 147900, 150000,
]

export const DEFAULT_LABOR_PENSION_RATES = LABOR_PENSION_SALARIES.map(
  (insuredSalary, index) => ({
    level: index + 1,
    insuredSalary,
    workerFee: 0,
    employerFee: Math.round(insuredSalary * 0.06),
  })
)

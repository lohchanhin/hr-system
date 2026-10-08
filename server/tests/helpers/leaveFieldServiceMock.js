// 測試用：把「只 mock 一張請假表單（getLeaveFieldIds）」的舊寫法，補上多張請假表單的 getAllLeaveFieldInfos。
// 假勤日曆、排班檢核等現在改用 getAllLeaveFieldInfos；預設回傳 getLeaveFieldIds 目前回傳的那一張（有 form 與日期欄位才算）。
// 要測多張請假表單時，傳入 getAllOverride：它回傳陣列就用該陣列，回傳 null / undefined 則維持預設。
// 刻意不用 jest.fn，這樣 jest.resetAllMocks() 不會把它清掉。
export function buildLeaveFieldServiceMock(getLeaveFieldIds, { getAllOverride } = {}) {
  return {
    getLeaveFieldIds,
    getAllLeaveFieldInfos: async () => {
      const override = getAllOverride?.();
      if (override) return override;
      const info = await getLeaveFieldIds();
      return info?.formId && info.startId && info.endId ? [info] : [];
    },
  };
}

winbox.spider.register('fixture-spider', {
  searchContent: async (input, { signal }) => {
    if (signal.aborted) throw new Error('fixture canceled');
    const { key } = input.args;
    if (key === 'fail') throw new Error('fixture Spider failure');
    if (key === 'wait') {
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('fixture canceled')), { once: true });
      });
    }
    return JSON.stringify({ list: [{ vod_name: key, api: input.source.api }] });
  },
  detailContent: async (input) => JSON.stringify({ list: [{ vod_id: input.args.ids[0] }] }),
});

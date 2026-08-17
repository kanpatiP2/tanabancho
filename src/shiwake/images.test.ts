import { afterEach, describe, expect, it, vi } from 'vitest';
import { readImageFiles, splitDataUrl } from './images';

/**
 * v1 の実害バグ（明細順の入れ替わり）の回帰テスト。
 * FileReader を「完了順が入力順の逆」になるよう差し替えても、結果は選択順でなければならない。
 */

type ReaderHandler = (() => void) | null;

interface FakeOptions {
  /** 各ファイルの完了までの遅延（ms 相当のタイマー段数）。省略時は逆順 */
  delays?: number[];
  failAt?: number;
}

function installFakeFileReader(opts: FakeOptions = {}) {
  const order: string[] = [];
  let seq = 0;

  class FakeFileReader {
    onload: ReaderHandler = null;
    onerror: ReaderHandler = null;
    result: string | null = null;
    error: Error | null = null;

    readAsDataURL(file: { name: string }): void {
      const index = seq++;
      const delay = opts.delays?.[index] ?? 1000 - index * 100; // 既定: 後のファイルほど早く終わる
      setTimeout(() => {
        if (opts.failAt === index) {
          this.error = new Error('boom');
          this.onerror?.();
          return;
        }
        order.push(file.name);
        this.result = `data:image/jpeg;base64,${file.name}`;
        this.onload?.();
      }, delay);
    }
  }

  vi.stubGlobal('FileReader', FakeFileReader);
  return { completionOrder: order };
}

function fakeFile(name: string): File {
  return { name } as unknown as File;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('readImageFiles', () => {
  it('FileReader の完了順が逆転しても選択順を維持する', async () => {
    const { completionOrder } = installFakeFileReader();
    vi.useFakeTimers();

    const promise = readImageFiles([fakeFile('a.jpg'), fakeFile('b.jpg'), fakeFile('c.jpg')]);
    await vi.runAllTimersAsync();
    const result = await promise;

    // 完了順は逆転している（テストが実際にバグ条件を再現していることの確認）
    expect(completionOrder).toEqual(['c.jpg', 'b.jpg', 'a.jpg']);
    // それでも結果は選択順
    expect(result.map((r) => r.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(result.map((r) => r.dataUrl)).toEqual([
      'data:image/jpeg;base64,a.jpg',
      'data:image/jpeg;base64,b.jpg',
      'data:image/jpeg;base64,c.jpg',
    ]);
  });

  it('完了順がばらばらでも選択順を維持する', async () => {
    installFakeFileReader({ delays: [50, 10, 90, 30] });
    vi.useFakeTimers();

    const promise = readImageFiles(['1', '2', '3', '4'].map((n) => fakeFile(`${n}.jpg`)));
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.map((r) => r.name)).toEqual(['1.jpg', '2.jpg', '3.jpg', '4.jpg']);
  });

  it('1枚でも失敗したら reject する（順序が欠けた明細を作らない）', async () => {
    installFakeFileReader({ failAt: 1 });
    vi.useFakeTimers();

    const promise = readImageFiles([fakeFile('a.jpg'), fakeFile('b.jpg')]);
    const assertion = expect(promise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('空配列は空配列', async () => {
    installFakeFileReader();
    await expect(readImageFiles([])).resolves.toEqual([]);
  });
});

describe('splitDataUrl', () => {
  it('mime と base64 を分離する', () => {
    expect(splitDataUrl('data:image/png;base64,AAAA')).toEqual({ mimeType: 'image/png', data: 'AAAA' });
  });

  it('壊れた入力でも既定 mime を返す', () => {
    expect(splitDataUrl('nonsense')).toEqual({ mimeType: 'image/jpeg', data: '' });
  });
});

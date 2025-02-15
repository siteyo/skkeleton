import {
  BaseSource,
  GatherArguments,
  GetCompletePositionArguments,
  GetPreviewerArguments,
  OnCompleteDoneArguments,
} from "../skkeleton/deps/ddc/source.ts";
import { DdcGatherItems, Previewer } from "../skkeleton/deps/ddc/types.ts";
import { fn } from "../skkeleton/deps.ts";
import type { CompletionData, RankData } from "../skkeleton/types.ts";

export type CompletionMetadata = {
  kana: string;
  word: string;
  rank: number;
};

type Params = Record<string, never>;

export class Source extends BaseSource<Params> {
  async getCompletePosition(
    args: GetCompletePositionArguments<Record<string, never>>,
  ): Promise<number> {
    const inputLength = args.context.input.length;
    const preEditLength =
      (await args.denops.dispatch("skkeleton", "getPreEditLength")) as number;
    return inputLength - preEditLength;
  }

  async gather(
    args: GatherArguments<Params>,
  ): Promise<DdcGatherItems> {
    const candidates = (await args.denops.dispatch(
      "skkeleton",
      "getCandidates",
    )) as CompletionData;
    const ranks = new Map(
      (await args.denops
        .dispatch("skkeleton", "getRanks")) as RankData,
    );
    candidates.sort((a, b) => a[0].localeCompare(b[0]));

    // グローバル辞書由来の候補はユーザー辞書の末尾より配置する
    // 辞書順に並べるため先頭から順に負の方向にランクを振っていく
    let globalRank = -1;

    // NOTE: neovim < 0.10 の場合、floatwin 境界にマルチバイトがあると表示が崩
    // れるバグがある
    const abbrPrefix = args.denops.meta.host === "nvim" &&
        !await fn.has(args.denops, "nvim-0.10")
      ? " "
      : "";
    const ddcCandidates = candidates.flatMap((e) => {
      return e[1].map((word) => ({
        word: word.replace(/;.*$/, ""),
        // NOTE: add space for workaround of neovim draw screen bug
        abbr: abbrPrefix + word.replace(/;.*$/, ""),
        info: word.indexOf(";") > 1 ? word.replace(/.*;/, "") : "",
        user_data: {
          kana: e[0],
          word,
          rank: ranks.get(word) ?? globalRank--,
        },
      }));
    });
    ddcCandidates.sort((a, b) => b.user_data.rank - a.user_data.rank);
    return {
      items: ddcCandidates,
      isIncomplete: false,
    };
  }

  params() {
    return {};
  }

  getPreviewer(
    args: GetPreviewerArguments<Params, unknown>,
  ): Promise<Previewer> {
    if (!args.item.info || args.item.info.length === 0) {
      return Promise.resolve({
        kind: "empty",
      });
    }

    return Promise.resolve({
      kind: "text",
      contents: [args.item.info],
    });
  }

  async onCompleteDone(
    args: OnCompleteDoneArguments<Params, CompletionMetadata>,
  ) {
    await args.denops.dispatch(
      "skkeleton",
      "completeCallback",
      args.userData.kana,
      args.userData.word,
    );
  }
}

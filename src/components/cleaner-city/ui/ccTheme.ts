/** Visual tokens aligned to Cleaner City mockup frames. */
export const cc = {
  bg: 'bg-[#F7F5F1]',
  page: 'mx-auto flex w-full max-w-lg flex-col gap-4 px-4 pt-3 pb-28',
  forest: 'bg-[#0F3D2E]',
  forestHover: 'hover:bg-[#0C3226]',
  forestText: 'text-[#0F3D2E]',
  forestSoft: 'bg-[#E8F2EC]',
  forestBorder: 'border-[#0F3D2E]/15',
  card: 'rounded-2xl border border-black/5 bg-white shadow-[0_1px_2px_rgba(15,61,46,0.04)]',
  primaryBtn:
    'inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#0F3D2E] px-4 text-[15px] font-semibold text-white transition hover:bg-[#0C3226] active:scale-[0.98] disabled:opacity-60',
  secondaryBtn:
    'inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white px-4 text-[15px] font-semibold text-foreground transition active:scale-[0.98]',
  sectionLabel: 'text-[13px] font-semibold text-foreground',
  meta: 'text-[12px] text-muted-foreground',
  pillActive: 'rounded-full bg-[#0F3D2E] px-3 py-1.5 text-[12px] font-semibold text-white',
  pillIdle:
    'rounded-full border border-black/10 bg-white px-3 py-1.5 text-[12px] font-semibold text-muted-foreground',
} as const;

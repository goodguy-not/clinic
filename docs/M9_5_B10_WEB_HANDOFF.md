# M9.5 B10 Web handoff

Base: Agent A `fa4b090` on `milestone/09.5-agent-a`, fast-forwarded into
`codex/milestone-09.5-web`. All B10 implementation changes are in `apps/web`,
its package/lockfile, and this handoff. No API or contracts source was edited.

## Agent A mechanical Web review

| File                                             | Verdict                                                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `server/draft-preview.ts`                        | Accepted: erased assets are excluded and nullable descriptions handled.                                               |
| `content/article-image-editor.tsx`               | Accepted: nullable description fallback is safe; B10 also excludes erased assets and clarifies variable public crops. |
| `content/services/[id]/service-image-editor.tsx` | Accepted: same; B10 excludes erased assets and explains the two public crops.                                         |
| `content/testimonial-image-editor.tsx`           | Accepted: same; B10 excludes erased assets and matches the public portrait crop.                                      |
| `media/media-workspace.tsx`                      | Accepted: null description is safe; B10 adds explicit erased and archived states.                                     |
| `components/media-alt-text-editor.tsx`           | Accepted: null is safe; B10 suppresses the editor after erasure.                                                      |
| `public-b7.test.tsx`                             | Accepted: public fixture no longer invents internal media ID.                                                         |
| `public-seo.test.ts`                             | Accepted: same.                                                                                                       |
| `service-imagery.test.tsx`                       | Accepted: same.                                                                                                       |
| `public-media-image.test.tsx`                    | Accepted: same.                                                                                                       |

## Results and evidence

1. **Media caching.** Web relays `private, no-cache` and ETag from the API,
   including a conditional 304 with no body. The API is called with `no-store`
   on every Web request, so revocation is rechecked immediately. A synthetic
   live Web-origin sequence recorded 200 with ETag and 4,878 bytes; conditional
   304 with zero bytes; conditional 404 after unpublish:
   `E:\work\clinic\gate-evidence\m9.5-b10\media-origin-evidence.txt`.
   The recursive public internal-ID stripper was removed: the strict public
   contract has no media ID. The `public-media:` cache tag invalidation was
   retained for publication paths that still call it; it no longer controls
   private media bytes.
2. **Upload without lost work.** Upload completion updates the local success
   state and preview immediately; it does not reload the document. The
   `media-upload-framing-workflow.test.tsx` browser-DOM test enters unsaved
   sibling text, completes an upload, and verifies the text remains. The
   in-app browser file chooser timed out twice, so **after-upload Manager and
   Receptionist screenshots were not captured**. This is an evidence gap,
   not a claim of a successful manual upload run.
3. **Photo guidance.** The space detail is **square 1:1**: the public control
   is 112 by 112 pixels, and staff now see the square close-up guide. The
   handwritten testimonial card is now portrait 4:5, matching its upload
   control. Responsive and reused public crops are called out to staff.

   | Slot                    | Persian guidance shown to staff                                                                                  | Public rendering                                  |
   | ----------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
   | Therapist portrait      | «عکس چهره را در قاب عمودی تنظیم کنید؛ در کارت‌های کوچک‌تر اطراف آن بریده می‌شود»; قاب عمودی 4:5                  | Tall profile, team and small card crops           |
   | Service photo           | «در فهرست خدمات به‌صورت ایستاده‌تر و در بالای صفحهٔ خدمت به‌صورت پهن بریده می‌شود»; قاب افقی 3:2 or قاب پهن 16:9 | Tall list crop and wide detail hero               |
   | Article photo           | «در کارت معرفی مطلب ایستاده‌تر و در صفحهٔ مطلب پهن‌تر دیده می‌شود»; قاب افقی 3:2 or قاب پهن 16:9                 | Tall featured card and wide reading image         |
   | Handwritten testimonial | «در کارت عمودی ۴:۵ ... نمایش داده می‌شود»; قاب عمودی 4:5                                                         | Portrait 4:5 card                                 |
   | Home concern            | «در پاسخ صفحهٔ خانه، عکس به‌صورت پهن کنار متن دیده می‌شود»; قاب پهن 16:9                                         | Wide answer panel                                 |
   | Home first visit        | «در معرفی نخستین مراجعه، عکس در قاب افقی کنار متن دیده می‌شود»; قاب افقی 3:2                                     | Landscape panel beside text                       |
   | About intro             | «در آغاز صفحهٔ دربارهٔ کلینیک، عکس به‌صورت پهن پشت متن دیده می‌شود»; قاب پهن 16:9                                | Full-width wide header, responsive crop           |
   | About space note        | «در توضیح طراحی فضا، عکس در قاب افقی کنار متن دیده می‌شود»; قاب افقی 3:2                                         | Landscape image column                            |
   | Site sharing image      | «کنار معرفی سایت در قاب پهن دیده می‌شود»; قاب پهن 16:9                                                           | Wide social preview; destination may crop         |
   | Space main              | «نمای کلی فضا؛ برای قاب پهن ۱۶:۹ ... پنل بسته باریک‌تر دیده می‌شود»                                              | Wide expanded accordion panel; narrow when closed |
   | Space detail            | «نمای نزدیک ... قاب تقریباً مربع ۱:۱»                                                                            | Square 112×112 close-up                           |

   Space controls: `manager-space-main-control.png`,
   `manager-space-detail-control.png` in the evidence directory.

4. **Erased and archived staff media.** Erased media has an explicit Persian
   status, no broken preview, no description editor, and no refused action.
   Archived media shows its restore deadline in the panel's Persian date
   format. Screenshots: `manager-erased-archived-media.png`,
   `receptionist-erased-archived-media.png`.
5. **Consent withdrawal.** Only Manager sees the form and date-only history.
   The form states immediate removal, permanent erasure of text, attribution
   and every attached photo everywhere it appears, usually the same night and
   in any case within seven days, and that the action cannot be undone. Web
   enforces CSRF/Origin and returns a direct 403
   on an API permission refusal. The API integration suite proves a direct
   receptionist POST returns 403. Screenshots:
   `manager-consent-confirmation.png`, `manager-consent-history.png`,
   `receptionist-no-consent-action.png`.
6. **Operations warnings.** Manager dashboard explains stale off-site backup
   and missed nightly jobs in plain Persian with action to take. All-well
   state is quiet. Receptionist does not request or see these statuses.
   Screenshots: `manager-dashboard-warnings.png`,
   `receptionist-dashboard-no-warnings.png`.
7. **Health and logging.** Web `/api/health` uses API `/health/ready` and emits
   only `ok` or `unavailable`; tests cover readiness and error detail hiding.
   Web logging policy test prohibits server/handler console logging and upload
   filename access; malformed API data is handled without logging or echoing
   the payload.
8. **Verification.** Web tests: 81 files, 1,156 tests passed. Full API
   integration: 122 suites, 2,452 tests passed, log at
   `E:\work\clinic\gate-evidence\m9.5-b10\api-integration.log`.
   Web typecheck, lint, format, `check:boundary`, API production build and
   Web production build passed.

## Owner-approved erasure timing

The API erasure job selects every withdrawn testimonial on its next nightly
run, but the persisted `erasureDueBy`/A3 contract allows seven days and a
files-lock deferral can delay that run. The Web confirmation and history now
state the owner-approved rule: usually the same night, always within seven
days. This work did not change the API or contracts. The B10 consent screenshots
were captured before this wording correction; the source and Web tests pin the
current wording.

All named screenshots and live evidence above are under
`E:\work\clinic\gate-evidence\m9.5-b10\`. Data and accounts used for the
browser evidence were synthetic.

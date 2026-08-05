/**
 * Persian user-facing copy.
 *
 * NestJS returns English codes and developer messages; every Persian string in
 * the product lives here (CLAUDE.md, Architecture boundary).
 *
 * OWNER-APPROVED strings are marked. The rest are functional field labels and
 * button text — the minimum needed for a form to be usable and accessible, not
 * marketing, legal or clinical copy, none of which is invented anywhere in this
 * milestone.
 */

export const COPY = {
  /** OWNER-APPROVED. */
  passwordGuidance:
    'رمز عبور باید دست‌کم ۱۵ کاراکتر داشته باشد. استفاده از عبارت عبور، مدیر رمز و جای‌گذاری مجاز است.',

  /** OWNER-APPROVED. Shown for every login failure, whatever the real cause. */
  loginFailed: 'نام کاربری یا رمز عبور صحیح نیست. اگر مشکل ادامه داشت، با مدیر مجموعه تماس بگیرید.',

  /** OWNER-APPROVED. */
  sessionExpired: 'نشست شما پایان یافته یا معتبر نیست. برای ورود دوباره ادامه دهید.',

  /** OWNER-APPROVED. */
  sessionExpiredButton: 'ادامه به صفحه ورود',

  // --- functional labels ----------------------------------------------------

  loginTitle: 'ورود به سامانه',
  username: 'نام کاربری',
  password: 'رمز عبور',
  signIn: 'ورود',

  changePasswordTitle: 'تغییر رمز عبور',
  currentPassword: 'رمز عبور فعلی',
  newPassword: 'رمز عبور جدید',
  confirmNewPassword: 'تکرار رمز عبور جدید',
  changePasswordSubmit: 'ثبت رمز عبور جدید',
  passwordsDoNotMatch: 'رمز عبور جدید و تکرار آن یکسان نیستند.',
  mustChangePassword: 'برای ادامه باید رمز عبور خود را تغییر دهید.',

  staffTitle: 'مدیریت کاربران',
  staffCreateTitle: 'ایجاد کاربر جدید',
  displayName: 'نام نمایشی',
  role: 'نقش',
  roleManager: 'مدیر',
  roleReceptionist: 'پذیرش',
  status: 'وضعیت',
  statusActive: 'فعال',
  statusDisabled: 'غیرفعال',
  create: 'ایجاد',
  makeManager: 'ارتقا به مدیر',
  makeReceptionist: 'تغییر به پذیرش',
  disable: 'غیرفعال کردن',
  enable: 'فعال کردن',
  resetPassword: 'بازنشانی رمز عبور',
  unlock: 'رفع قفل',
  revokeSessions: 'پایان دادن به نشست‌ها',
  lockedUntil: 'قفل تا',
  never: '—',
  signOut: 'خروج',

  /** Shown once, immediately after a reset or a creation. */
  temporaryPasswordTitle: 'رمز عبور موقت',
  temporaryPasswordNotice:
    'این رمز فقط همین یک بار نمایش داده می‌شود. آن را به کاربر بدهید و در جایی ذخیره نکنید.',

  // --- clinic reference data -------------------------------------------------
  //
  // Functional labels and explanations: the minimum a manager needs to use the
  // form correctly and to understand what a choice does. No marketing, legal or
  // clinical wording is invented here.

  back: 'بازگشت',
  save: 'ذخیره',
  cancel: 'انصراف',
  edit: 'ویرایش',
  name: 'نام',

  servicesTitle: 'خدمات',
  servicesDescription: 'خدمات درمانگاه و مدت‌زمان‌های قابل رزرو برای هر کدام.',
  serviceNewTitle: 'افزودن خدمت',
  serviceEditTitle: 'ویرایش خدمت',
  serviceNameLabel: 'نام خدمت',
  serviceNameHelp: 'فاصله‌های ابتدا و انتها حذف می‌شود. نام هر خدمت باید یکتا باشد.',
  servicePublicDescriptionLabel: 'توضیح عمومی',
  servicePublicDescriptionHelp:
    'حداکثر ۲۰۰۰ نویسه. این متن برای وب‌سایت عمومی ذخیره می‌شود و فعلاً جایی نمایش داده نمی‌شود.',
  serviceVisibilityLegend: 'نمایش در وب‌سایت عمومی',
  serviceVisibilityHelp:
    'این گزینه فقط تعیین می‌کند که خدمت در وب‌سایت عمومی معرفی شود یا نه. رزرو داخلی به آن وابسته نیست.',
  servicePublicLabel: 'در وب‌سایت عمومی معرفی شود',
  servicePublicDescription2: 'نام و توضیح این خدمت در وب‌سایت عمومی نمایش داده خواهد شد.',
  servicePrivateLabel: 'فقط داخلی',
  servicePrivateDescription: 'این خدمت فقط در سامانهٔ داخلی دیده می‌شود.',
  serviceDurationsLabel: 'مدت‌زمان‌ها (دقیقه)',
  serviceDurationsHelp:
    'دست‌کم یک مقدار لازم است. مقادیر را با ویرگول جدا کنید؛ مثال: ۳۰، ۴۵، ۶۰. هر عدد باید بین ۱ تا ۴۸۰ باشد.',
  serviceDurationsValue: 'مدت‌زمان‌ها',
  serviceEmpty: 'هنوز خدمتی ثبت نشده است.',
  serviceAddAction: 'افزودن خدمت',
  servicePublicBadge: 'عمومی',
  servicePrivateBadge: 'داخلی',

  /**
   * Shown next to the durations field on the edit form. The rule it explains is
   * enforced by the database: a duration a tariff has ever priced cannot be
   * withdrawn, because the price that applied on a past date must stay readable.
   */
  serviceDurationRemovalWarning:
    'اگر برای یک مدت‌زمان تعرفه‌ای ثبت شده باشد، حذف آن ممکن نیست و پیام خطا نمایش داده می‌شود. برای کنار گذاشتن آن، به‌جای حذف، خدمت را غیرفعال کنید.',

  roomsTitle: 'اتاق‌ها',
  roomsDescription: 'اتاق‌های درمان و خدماتی که در هر اتاق قابل ارائه است.',
  roomNewTitle: 'افزودن اتاق',
  roomEditTitle: 'ویرایش اتاق',
  roomNameLabel: 'نام اتاق',
  roomNameHelp: 'فاصله‌های ابتدا و انتها حذف می‌شود. نام هر اتاق باید یکتا باشد.',
  roomEmpty: 'هنوز اتاقی ثبت نشده است.',
  roomAddAction: 'افزودن اتاق',

  /**
   * The restriction question is asked explicitly because an empty selection and
   * "no restriction" are the same thing in the data. Making the user choose
   * removes the guess.
   */
  roomRestrictionLegend: 'خدمات قابل ارائه در این اتاق',
  roomUnrestrictedLabel: 'قابل استفاده برای همهٔ خدمات',
  roomUnrestrictedDescription: 'هیچ محدودیتی ثبت نمی‌شود و اتاق برای همهٔ خدمات قابل انتخاب است.',
  roomRestrictedLabel: 'محدود به خدمات انتخاب‌شده',
  roomRestrictedDescription:
    'فقط خدماتی که در فهرست زیر انتخاب می‌کنید در این اتاق قابل ارائه‌اند.',
  roomServicesLabel: 'خدمات مجاز',
  roomServicesHelp:
    'اگر «محدود به خدمات انتخاب‌شده» را برگزیده‌اید، دست‌کم یک خدمت را انتخاب کنید. انتخاب چندتایی با نگه داشتن کلید Ctrl یا Command ممکن است.',
  roomUnrestrictedBadge: 'همهٔ خدمات',
  roomRestrictedCountLabel: 'خدمات مجاز',
  roomNoServicesAvailable:
    'هنوز خدمتی ثبت نشده است، بنابراین محدود کردن اتاق ممکن نیست. ابتدا یک خدمت اضافه کنید.',

  therapistsTitle: 'درمانگران',
  therapistsDescription: 'درمانگران درمانگاه و خدماتی که هر کدام ارائه می‌دهند.',
  therapistNewTitle: 'افزودن درمانگر',
  therapistEditTitle: 'ویرایش درمانگر',
  therapistFullNameLabel: 'نام و نام خانوادگی',
  therapistFullNameHelp:
    'فاصله‌های ابتدا و انتها حذف می‌شود. تکراری بودن نام مانعی ندارد؛ ممکن است دو نفر هم‌نام باشند.',
  therapistSpecialtyLabel: 'تخصص',
  therapistSpecialtyHelp: 'مثال: گفتاردرمانی، کاردرمانی.',
  therapistEmpty: 'هنوز درمانگری ثبت نشده است.',
  therapistAddAction: 'افزودن درمانگر',

  /**
   * Zero assigned services is a normal state for a newly entered therapist, so
   * the list says so plainly instead of leaving the row looking incomplete.
   */
  therapistServicesLegend: 'خدمات قابل ارائه توسط این درمانگر',
  therapistServicesHelp:
    'انتخاب خدمت اختیاری است و می‌توانید بعداً آن را تکمیل کنید. هر خدمت را که این درمانگر ارائه می‌دهد علامت بزنید.',
  therapistServicesValue: 'خدمات',
  therapistNoServices: 'خدمتی برای این درمانگر ثبت نشده است.',
  therapistNoServicesAvailable:
    'هنوز خدمتی ثبت نشده است. می‌توانید درمانگر را بدون خدمت ذخیره کنید و بعداً خدمات را اضافه کنید.',
  serviceInactiveBadge: 'خدمت غیرفعال',

  tariffsTitle: 'تعرفه‌ها',
  tariffsDescription: 'قیمت هر خدمت و مدت‌زمان، با بازهٔ زمانی اعتبار.',
  tariffNewTitle: 'افزودن تعرفه',
  tariffCorrectTitle: 'اصلاح تعرفه',
  tariffEmpty: 'هنوز تعرفه‌ای ثبت نشده است.',
  tariffAddAction: 'افزودن تعرفه',

  tariffServiceDurationLabel: 'خدمت و مدت‌زمان',
  tariffServiceDurationHelp:
    'فهرست فقط ترکیب‌های معتبر خدمت و مدت‌زمان را نشان می‌دهد. خدمات غیرفعال و خدماتی که مدت‌زمانی ندارند در فهرست نمی‌آیند.',
  tariffNoServiceDurations:
    'برای ثبت تعرفه، ابتدا باید خدمتی فعال با دست‌کم یک مدت‌زمان تعریف شده باشد.',

  tariffScopeLegend: 'دامنهٔ تعرفه',
  tariffScopeGeneralLabel: 'عمومی (همهٔ درمانگران)',
  tariffScopeGeneralDescription:
    'این قیمت برای هر درمانگری که این خدمت را ارائه می‌دهد به کار می‌رود، مگر آنکه تعرفهٔ اختصاصی همان درمانگر ثبت شده باشد.',
  tariffScopeTherapistLabel: 'اختصاصی یک درمانگر',
  tariffScopeTherapistDescription:
    'این قیمت فقط برای درمانگر انتخاب‌شده به کار می‌رود و بر تعرفهٔ عمومی اولویت دارد.',
  tariffTherapistLabel: 'درمانگر',
  tariffTherapistHelp: 'فقط درمانگران فعال قابل انتخاب‌اند.',

  tariffPriceModeLegend: 'نوع تعرفه',
  tariffPaidLabel: 'پرداختی',
  tariffPaidDescription: 'خانواده برای این جلسه مبلغ مشخصی می‌پردازد.',
  tariffFreeLabel: 'رایگان',
  tariffFreeDescription:
    'یک برنامهٔ رایگان درمانگاه، مانند غربالگری یا مشاورهٔ اولیه. این گزینه برای تخفیف یک خانوادهٔ خاص نیست.',
  tariffPriceLabel: 'مبلغ (تومان)',
  tariffPriceHelp:
    'عدد را بدون جداکننده وارد کنید. مبلغ باید بیشتر از صفر باشد؛ برای برنامهٔ رایگان گزینهٔ «رایگان» را انتخاب کنید.',
  tariffFreeReasonLabel: 'دلیل رایگان بودن',
  tariffFreeReasonHelp: 'مثال: کمپین غربالگری رایگان.',

  /** The confirmation exists so a free programme is always a deliberate choice. */
  tariffFreeConfirmLabel:
    'تأیید می‌کنم این یک برنامهٔ رایگان درمانگاه است، نه تخفیف برای یک خانوادهٔ خاص.',

  tariffEffectiveStartLabel: 'شروع اعتبار',
  tariffEffectiveEndLabel: 'پایان اعتبار (اختیاری)',
  tariffEffectiveEndHelp: 'اگر خالی بماند، این تعرفه تا زمان ثبت تعرفهٔ جایگزین معتبر است.',
  tariffDateYear: 'سال',
  tariffDateMonth: 'ماه',
  tariffDateDay: 'روز',
  tariffDateNotSet: '—',

  tariffFreeBadge: 'رایگان',
  tariffStateCurrent: 'در حال اجرا',
  tariffStateFuture: 'آینده',
  tariffStateExpired: 'منقضی',
  tariffStateVoided: 'ابطال‌شده',
  tariffScopeGeneralBadge: 'عمومی',
  tariffPeriodLabel: 'بازهٔ اعتبار',
  tariffVoidedAtLabel: 'ابطال در',
  tariffVoidReasonLabel: 'دلیل ابطال',

  tariffVoidAction: 'ابطال',
  tariffCorrectAction: 'ثبت اصلاحیه',
  tariffVoidReasonLabelInput: 'دلیل ابطال',
  tariffVoidReasonHelp: 'دلیل ابطال در تاریخچه ثبت می‌شود و قابل تغییر نیست.',
  tariffVoidConfirmTitle: 'ابطال تعرفه',
  tariffVoidContextHelp:
    'پیش از ابطال، خدمت، مدت‌زمان و دامنهٔ تعرفه را بررسی کنید. تعرفهٔ ابطال‌شده دیگر برای قیمت‌گذاری استفاده نمی‌شود، اما در تاریخچه باقی می‌ماند.',

  /** Shown on the correction form, where scope is fixed by the tariff being replaced. */
  tariffSupersedeNotice:
    'این فرم جایگزین یک تعرفهٔ موجود است. خدمت، مدت‌زمان و دامنهٔ آن قابل تغییر نیست؛ برای قیمتی با دامنهٔ متفاوت، تعرفهٔ جدید ثبت کنید.',
  tariffImmutableNotice:
    'تعرفهٔ ثبت‌شده قابل ویرایش نیست. برای تغییر قیمت، تعرفهٔ فعلی را ابطال کنید و اصلاحیه ثبت کنید تا قیمت گذشته دست‌نخورده بماند.',

  activate: 'فعال کردن',
  deactivate: 'غیرفعال کردن',
  statusInactive: 'غیرفعال',
} as const;

export type CopyKey = keyof typeof COPY;

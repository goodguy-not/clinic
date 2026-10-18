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

  appTitle: 'سامانه داخلی کلینیک',
  menuLabel: 'منو',
  moreSections: 'بخش‌های مدیریتی',
  homeWelcome: 'نمای امروز کلینیک و کارهایی که نیاز به پیگیری دارند.',

  // --- daily dashboard -----------------------------------------------------

  dashboardTitle: 'داشبورد روزانه',
  dashboardOpenDay: 'مشاهدهٔ برنامهٔ روز',
  dashboardLoadFailure: 'داشبورد در حال حاضر بارگیری نشد. کمی بعد دوباره تلاش کنید.',
  dashboardRetry: 'تلاش دوباره',
  dashboardLoading: 'در حال آماده‌کردن نمای امروز کلینیک…',
  dashboardAppointments: 'نوبت‌های امروز',
  dashboardTotalAppointments: 'کل نوبت‌ها',
  dashboardScheduledAppointments: 'در انتظار برگزاری',
  dashboardCompletedAppointments: 'انجام‌شده',
  dashboardCancelledAppointments: 'لغوشده',
  dashboardNoShows: 'عدم حضور',
  dashboardUnresolvedAppointments: 'نتیجهٔ ثبت‌نشده',
  dashboardAvailabilityOverrides: 'نوبت خارج از برنامه با مجوز ثبت‌شده',
  dashboardAvailabilityOverridesHelp:
    'این عدد یک تصمیم مجاز و ثبت‌شده است، نه تداخل برنامه یا خطای داده‌ای.',
  dashboardNoAppointments: 'برای این روز نوبتی ثبت نشده است.',
  dashboardAttention: 'نیازمند پیگیری',
  dashboardAttentionClear: 'مورد باز یا خطای داده‌ای برای پیگیری وجود ندارد.',
  dashboardWebsiteRequests: 'درخواست‌های جدید ارزیابی وب‌سایت',
  dashboardPromiseDueToday: 'قول پرداخت سررسید امروز',
  dashboardPromiseMissed: 'قول پرداخت عقب‌افتاده',
  dashboardMissingTariff: 'نوبت بدون تعرفهٔ قابل اعمال',
  dashboardUnchargedSession: 'جلسهٔ انجام‌شدهٔ بدون هزینه',
  dashboardIssuesOverlap:
    'خطاهای تعرفه و جلسهٔ بدون هزینه جداگانه شمرده می‌شوند و ممکن است هم‌پوشانی داشته باشند.',
  dashboardReviewDay: 'بررسی برنامهٔ روز',
  dashboardMyReconciliation: 'ثبت‌های مالی من',
  dashboardMyReconciliationHelp:
    'پرداخت‌هایی که شما در این روز در سامانه ثبت کرده‌اید؛ تاریخ دریافت ممکن است روز دیگری باشد.',
  dashboardConfirmedPayments: 'پرداخت تأییدشده',
  dashboardVoidedPayments: 'پرداخت باطل‌شده',
  dashboardNoPayments: 'شما در این روز پرداختی ثبت نکرده‌اید.',
  dashboardPaymentEntries: 'ریز ثبت‌های من',
  dashboardReceivedOn: 'تاریخ دریافت وجه',
  dashboardPaymentConfirmed: 'تأییدشده',
  dashboardPaymentVoided: 'باطل‌شده',
  dashboardPaymentCash: 'نقدی',
  dashboardPaymentCard: 'کارت',
  dashboardPaymentTransfer: 'انتقال بانکی',
  dashboardClinicFinancial: 'نمای مالی کلینیک',
  dashboardManagerOnly: 'ویژهٔ مدیر',
  dashboardClinicFinancialHelp:
    'نمای ویژهٔ مدیر؛ مبالغ دریافتی و هزینهٔ جلسه‌ها دو واقعیت با مبنای زمانی متفاوت‌اند.',
  dashboardClinicPayments: 'پرداخت‌های ثبت‌شدهٔ کلینیک',
  dashboardClinicCharges: 'هزینهٔ جلسه‌های این روز',
  dashboardNetCharged: 'مبلغ مؤثر ثبت‌شده',
  dashboardActiveCharges: 'هزینهٔ معتبر',
  dashboardVoidedCharges: 'هزینهٔ باطل‌شده',
  dashboardByRecorder: 'به تفکیک ثبت‌کننده',
  dashboardNoClinicPayments: 'در این روز پرداختی در کلینیک ثبت نشده است.',
  dashboardCountUnit: 'مورد',

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
  view: 'مشاهده',
  name: 'نام',

  servicesTitle: 'خدمات',
  servicesDescription: 'خدمات درمانگاه و مدت‌زمان‌های قابل رزرو برای هر کدام.',
  serviceNewTitle: 'افزودن خدمت',
  serviceEditTitle: 'ویرایش خدمت',
  serviceNameLabel: 'نام خدمت',
  serviceNameHelp: 'فاصله‌های ابتدا و انتها حذف می‌شود. نام هر خدمت باید یکتا باشد.',
  servicePublicDescriptionLabel: 'توضیح عمومی',
  servicePublicDescriptionHelp:
    'حداکثر ۲۰۰۰ نویسه. این متن پس از عمومی‌کردن خدمت در صفحهٔ همان خدمت نمایش داده می‌شود؛ خالی‌بودن آن مانع انتشار نام خدمت نیست.',
  serviceVisibilityLegend: 'نمایش در وب‌سایت عمومی',
  serviceVisibilityHelp:
    'این گزینه فقط تعیین می‌کند که خدمت در وب‌سایت عمومی معرفی شود یا نه. رزرو داخلی به آن وابسته نیست.',
  servicePublicLabel: 'در وب‌سایت عمومی معرفی شود',
  servicePublicDescription2:
    'با همین ذخیره، خدمت روی وب‌سایت عمومی می‌رود. اگر توضیح خالی باشد، نام و صفحهٔ خدمت بدون توضیح منتشر می‌شود.',
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

  // --- therapist availability ----------------------------------------------
  availabilityTitle: 'برنامهٔ حضور درمانگران',
  availabilityDescription:
    'ساعت‌های هفتگی، تعطیلی‌های تاریخ‌دار و زمان‌های حضور اضافهٔ هر درمانگر.',
  availabilityChooseTherapist: 'برای دیدن برنامهٔ حضور، یک درمانگر را انتخاب کنید.',
  availabilityEmptyTherapists: 'هنوز درمانگری برای نمایش برنامهٔ حضور ثبت نشده است.',
  availabilityViewAction: 'برنامهٔ حضور',
  availabilityReadOnlyNotice:
    'این برنامه فقط برای مشاهده است. تغییر ساعت‌ها و استثناها در اختیار مدیر است.',
  availabilityInactiveNotice:
    'این درمانگر غیرفعال است. برنامهٔ ثبت‌شده قابل مشاهده است، اما تغییر آن پذیرفته نمی‌شود.',
  availabilityWeekTitle: 'هفتهٔ معمول',
  availabilityWeekDescription:
    'این ساعت‌ها الگوی جاری هر هفته‌اند. ذخیره، کل برنامهٔ هفتگی را یک‌جا جایگزین می‌کند.',
  availabilityNoStandingHours: 'ساعت هفتگی ثبت نشده است.',
  availabilityDayOff: 'بدون ساعت معمول',
  availabilityAddWindow: 'افزودن بازه',
  availabilityRemoveWindow: 'حذف بازه',
  availabilityStartTime: 'شروع',
  availabilityEndTime: 'پایان',
  availabilitySaveWeek: 'ذخیرهٔ برنامهٔ هفتگی',
  availabilityWeekSaved: 'برنامهٔ هفتگی با موفقیت جایگزین شد.',
  availabilityOverlapClient:
    'دو بازه در یک روز روی هم افتاده‌اند. پیش از ذخیره، ساعت‌ها را اصلاح کنید.',
  availabilityWindowLimit: 'حداکثر ۲۱ بازه در برنامهٔ هفتگی قابل ثبت است.',
  availabilityResolvedTitle: 'نتیجهٔ برنامه در یک تاریخ',
  availabilityResolvedDescription:
    'ساعت نهایی پس از اعمال تعطیلی و حضور اضافه را برای تاریخ انتخابی نشان می‌دهد.',
  availabilityResolveAction: 'نمایش این تاریخ',
  availabilityResolvedClosed: 'ساعت معمول این روز بسته است',
  availabilityResolvedOpen: 'برنامهٔ نهایی این روز',
  availabilityResolvedEmpty: 'در این تاریخ هیچ بازهٔ قابل رزروی وجود ندارد.',
  availabilityExceptionsTitle: 'تغییرهای تاریخ‌دار',
  availabilityExceptionsDescription:
    'تعطیلی، ساعت معمول را کنار می‌گذارد؛ حضور اضافهٔ همان تاریخ همچنان در برنامهٔ نهایی می‌ماند.',
  availabilityExceptionEmpty: 'هنوز تعطیلی یا حضور اضافه‌ای ثبت نشده است.',
  availabilityClosedTitle: 'ثبت روز بسته',
  availabilityClosedHelp: 'همهٔ ساعت‌های هفتگی این تاریخ کنار گذاشته می‌شود.',
  availabilityExtraTitle: 'ثبت حضور اضافه',
  availabilityExtraHelp: 'این بازه به همان تاریخ افزوده می‌شود، حتی اگر روز بسته ثبت شده باشد.',
  availabilityDateLabel: 'تاریخ',
  availabilityDateHelp: 'تاریخ را در تقویم شمسی وارد کنید.',
  availabilityReasonLabel: 'دلیل (اختیاری)',
  availabilityReasonHelp: 'مثال: مرخصی یا جلسهٔ جبرانی. از نوشتن اطلاعات پزشکی خودداری کنید.',
  availabilityAddClosed: 'ثبت روز بسته',
  availabilityAddExtra: 'ثبت حضور اضافه',
  availabilityExceptionAdded: 'تغییر تاریخ‌دار با موفقیت ثبت شد.',
  availabilityExceptionRemoved: 'تغییر تاریخ‌دار حذف شد.',
  availabilityRemoveException: 'حذف',
  availabilityClosedBadge: 'روز بسته',
  availabilityExtraBadge: 'حضور اضافه',
  availabilityNoReason: 'بدون دلیل ثبت‌شده',

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

  // --- families and children -------------------------------------------------

  familiesTitle: 'خانواده‌ها',
  websiteRequestsTitle: 'درخواست‌های ارزیابی وب‌سایت',
  familiesDescription: 'جست‌وجوی خانواده بر اساس نام، شمارهٔ تماس یا شمارهٔ پرونده.',
  familySearchLabel: 'جست‌وجو',
  familySearchHelp:
    'نام سرپرست، نام کودک، شمارهٔ موبایل یا تلفن ثابت، یا شمارهٔ پرونده را وارد کنید. خانواده‌های غیرفعال نیز پیدا می‌شوند تا بتوانید پرداخت یا بازپرداخت را پیگیری کنید.',
  familySearchButton: 'جست‌وجو',
  familySearchIncludeInactiveLabel: 'خانواده‌های غیرفعال هم در جست‌وجو باشند',
  familyAddAction: 'ثبت خانوادهٔ جدید',
  familyEmpty: 'خانواده‌ای یافت نشد.',
  familyRecentNotice: 'جدیدترین خانواده‌های ثبت‌شده نمایش داده می‌شود.',
  familyTruncatedNotice:
    'نتایج بیشتری وجود دارد؛ برای یافتن مورد موردنظر، جست‌وجوی دقیق‌تری انجام دهید.',
  familyAwaitingFirstChild: 'هنوز کودکی برای این خانواده ثبت نشده است.',
  familyGuardianCountLabel: 'سرپرست',
  familyChildCountLabel: 'کودک',

  familyAddressLabel: 'نشانی',
  familyNoteLabel: 'یادداشت غیرپزشکی',
  familyNoteHelp: 'اینجا اطلاعات پزشکی، بالینی یا مربوط به درمان و جلسات درمانی ننویسید.',
  familyGuardiansTitle: 'سرپرستان',
  familyChildrenTitle: 'کودکان',
  familyAddChildAction: 'افزودن کودک',
  familyPrimaryContactBadge: 'تماس اصلی',
  familyDeactivateWarning:
    'غیرفعال کردن خانواده، کودکان آن را غیرفعال نمی‌کند و می‌توانید در هر زمان دوباره فعالش کنید.',

  familyNewTitle: 'ثبت خانوادهٔ جدید',
  familyEditTitle: 'ویرایش خانواده',
  familyNameLabel: 'نام خانواده (نام خانوادگی)',
  familyNameHelp: 'این نام به‌عنوان برچسب حساب خانواده استفاده می‌شود.',
  familyAddressHelp: 'اختیاری.',
  familyGuardiansLegend: 'سرپرستان',
  familyGuardiansHelp:
    'دست‌کم یک سرپرست لازم است. دقیقاً یکی از آن‌ها باید «تماس اصلی» باشد و شمارهٔ موبایل یا تلفن ثابت داشته باشد.',
  guardianSlotLabel: 'سرپرست',
  guardianFullNameLabel: 'نام و نام خانوادگی',
  guardianRelationshipLabel: 'نسبت',
  relationshipMother: 'مادر',
  relationshipFather: 'پدر',
  relationshipGrandmother: 'مادربزرگ',
  relationshipGrandfather: 'پدربزرگ',
  relationshipGuardian: 'سرپرست دیگر',
  relationshipOther: 'سایر',
  guardianRelationshipNoteLabel: 'توضیح نسبت',
  guardianRelationshipNoteHelp: 'برای نسبت «سایر» پر کردن این فیلد لازم است.',
  guardianMobileLabel: 'موبایل',
  guardianLandlineLabel: 'تلفن ثابت',
  guardianPrimaryLabel: 'تماس اصلی',
  guardianPrimaryHelp:
    'دقیقاً یک سرپرست را به‌عنوان تماس اصلی انتخاب کنید. تماس اصلی باید موبایل یا تلفن ثابت داشته باشد.',

  childNewTitle: 'ثبت کودک جدید',
  childEditTitle: 'ویرایش اطلاعات کودک',
  childFirstNameLabel: 'نام',
  childLastNameLabel: 'نام خانوادگی',
  childBirthDateLabel: 'تاریخ تولد',
  childSexLabel: 'جنسیت',
  sexFemale: 'دختر',
  sexMale: 'پسر',
  sexUnspecified: 'نامشخص',
  childNationalIdLabel: 'کد ملی',
  childNationalIdHelp: 'اختیاری. برای نوزادی که هنوز کد ملی ندارد لازم نیست.',
  childLegacyFileNumberLabel: 'شمارهٔ پروندهٔ کاغذی',
  childLegacyFileNumberHelp:
    'اختیاری. شمارهٔ پروندهٔ قدیمی این کودک در بایگانی کاغذی، در صورت وجود.',
  childReferralSourceLabel: 'معرف',
  childReferralSourceHelp: 'اختیاری. مثال: توصیهٔ آشنایان، جست‌وجوی اینترنتی.',
  childFileNumberLabel: 'شمارهٔ پرونده',
  childStatusLabel: 'وضعیت کودک',

  // --- family financial account -------------------------------------------

  familyAccountAction: 'حساب مالی',
  familyFinancialPositionTitle: 'جایگاه مالی کل خانواده',
  familyFinancialPositionScope:
    'این جمع‌ها همهٔ کودکان و همهٔ سوابق ثبت‌شدهٔ خانواده را پوشش می‌دهد.',
  familyFinancialPositionHistoricalWarning:
    'این جایگاه مالی فقط بر پایهٔ سوابق ثبت‌شده در این سامانه است و بدهی‌های قدیمیِ کاغذی یا ماندهٔ افتتاحیه را شامل نمی‌شود.',
  familyAccountTitle: 'حساب مالی خانواده',
  familyAccountDescription: 'تاریخچهٔ مبالغ ثبت‌شده برای جلسه‌ها، تخفیف‌ها و موارد باطل‌شده.',
  familyAccountTotalsTitle: 'جمع خانواده',
  familyAccountChargedTotal: 'جمع مبلغ اولیهٔ جلسه‌ها',
  familyAccountAdjustmentTotal: 'جمع تخفیف‌های فعال',
  familyAccountEffectiveTotal: 'جمع مبلغ مؤثر ثبت‌شده',
  familyAccountActiveChargeCount: 'جلسهٔ دارای اثر مالی',
  familyAccountVoidedChargeCount: 'جلسهٔ باطل‌شده',
  familyAccountFiltersTitle: 'فیلتر تاریخچه',
  familyAccountChildFilter: 'کودک',
  familyAccountAllChildren: 'همهٔ کودکان',
  familyAccountHistoryFilter: 'نمایش موارد باطل‌شده',
  familyAccountHistoryShown: 'نمایش کامل تاریخچه',
  familyAccountHistoryHidden: 'مخفی کردن موارد باطل‌شده',
  familyAccountApplyFilters: 'اعمال فیلتر',
  familyAccountClearFilters: 'پاک کردن فیلترها',
  familyAccountChargesTitle: 'تاریخچهٔ جلسه‌ها',
  familyAccountEmpty: 'برای این خانواده و فیلترهای انتخاب‌شده، مبلغی ثبت نشده است.',
  familyAccountOriginalAmount: 'مبلغ اولیهٔ جلسه',
  familyAccountActiveAdjustments: 'تخفیف فعال',
  familyAccountEffectiveAmount: 'مبلغ مؤثر ثبت‌شده',
  familyAccountFree: 'رایگان از ابتدا',
  familyAccountFullyAdjusted: 'تعرفهٔ مبلغ‌دار، تخفیف کامل',
  familyAccountVoided: 'باطل‌شده',
  familyAccountVoidedNoEffect: 'این ردیف تاریخی است و در جمع فعلی خانواده اثر ندارد.',
  familyAccountVoidReason: 'دلیل ابطال',
  familyAccountVoidedAt: 'زمان ابطال',
  familyAccountAdjustmentsTitle: 'تخفیف‌های ثبت‌شده',
  familyAccountClinicFunded: 'تخفیف تأمین‌شده توسط کلینیک',
  familyAccountAdjustmentReason: 'دلیل تخفیف',
  familyAccountVoidedAdjustment: 'تخفیف باطل‌شده',
  familyAccountVoidedAdjustmentNoEffect: 'این تخفیف دیگر اثر مالی ندارد.',
  familyAccountManagerCorrection: 'اصلاح مالی مدیر',
  familyAccountChargeVoidTitle: 'ابطال هزینهٔ جلسه',
  familyAccountChargeVoidHelp:
    'ردیف مالی اصلی در تاریخچه می‌ماند و جلسه یا هزینه حذف نمی‌شود. این گام مالی باید پیش از اصلاح وضعیت جلسه، مانند بازگشایی، انجام شود.',
  familyAccountChargeVoidAction: 'ثبت ابطال هزینه',
  familyAccountAdjustmentCreateTitle: 'ثبت تخفیف یا بخشودگی',
  familyAccountAdjustmentClinicOnly:
    'تمام تخفیف‌های این مرحله به‌طور کامل توسط کلینیک تأمین می‌شوند. تخفیف کامل همچنان یک تعرفهٔ مبلغ‌دار با تخفیف است، نه تعرفهٔ رایگان از ابتدا.',
  familyAccountAdjustmentAmount: 'مبلغ تخفیف (تومان)',
  familyAccountAdjustmentAmountHelp:
    'مبلغ مجاز را سامانهٔ مالی بررسی می‌کند؛ مبلغ باقی‌مانده در این صفحه محاسبه نمی‌شود.',
  familyAccountAdjustmentCreateAction: 'ثبت تخفیف کلینیک',
  familyAccountAdjustmentVoidTitle: 'ابطال تخفیف',
  familyAccountAdjustmentVoidHelp:
    'تخفیف و دلیل ایجاد آن در تاریخچه می‌ماند، اما اثر مالی فعلی آن برداشته می‌شود. برای ابطال، دلیل جدید لازم است.',
  familyAccountAdjustmentVoidAction: 'ثبت ابطال تخفیف',
  familyAccountCorrectionReason: 'دلیل',
  familyAccountCorrectionReasonHelp: 'دلیل الزامی است و در سابقهٔ مالی ثبت می‌شود.',
  familyAccountChargeVoidedSuccess: 'هزینهٔ جلسه باطل شد و در تاریخچه باقی ماند.',
  familyAccountAdjustmentCreatedSuccess: 'تخفیف تأمین‌شده توسط کلینیک ثبت شد.',
  familyAccountAdjustmentVoidedSuccess: 'تخفیف باطل شد و در تاریخچه باقی ماند.',
  familyAccountService: 'خدمت',
  familyAccountTherapist: 'درمانگر',
  familyAccountSessionDate: 'تاریخ جلسه',
  familyAccountDuration: 'مدت جلسه',
  familyAccountMinutes: 'دقیقه',
  familyAccountPreviousPage: 'صفحهٔ قبل',
  familyAccountNextPage: 'صفحهٔ بعد',
  familyAccountPageLabel: 'صفحه',
  familyAccountOfRows: 'ردیف در این فیلتر',

  // --- family payments ----------------------------------------------------

  paymentEntryTitle: 'ثبت سریع پرداخت',
  paymentEntryHelp: 'پرداخت برای کل خانواده ثبت می‌شود؛ نیازی به انتخاب کودک یا جلسه نیست.',
  paymentAmount: 'مبلغ (تومان)',
  paymentAmountHelp: 'ارقام فارسی یا انگلیسی پذیرفته می‌شود.',
  paymentMethod: 'روش پرداخت',
  paymentReceivedOn: 'تاریخ دریافت',
  paymentReceivedOnHelp: 'روزی که مبلغ واقعاً دریافت شده است.',
  paymentReference: 'شماره پیگیری یا مرجع',
  paymentReferenceHelp: 'اختیاری؛ برای کارت یا انتقال بانکی.',
  paymentNote: 'یادداشت',
  paymentNoteHelp: 'اختیاری؛ توضیح کوتاه برای پیگیری داخلی.',
  paymentCreateAction: 'ثبت پرداخت دریافتی',
  paymentRecentTitle: 'پرداخت‌های اخیر',
  paymentRecentHelp: 'پیش از ثبت، این فهرست را برای پرداخت تکراری بررسی کنید.',
  paymentToday: 'امروز',
  paymentNoRecent: 'هنوز پرداختی برای این خانواده ثبت نشده است.',
  paymentHistoryTitle: 'پرداخت‌های خانواده',
  paymentHistoryDescription: 'سابقهٔ کامل دریافت‌ها و اصلاحات مالی خانواده.',
  paymentHistoryEmpty: 'در این فیلتر، پرداختی وجود ندارد.',
  paymentFiltersTitle: 'فیلتر تاریخچهٔ پرداخت',
  paymentStatus: 'وضعیت پرداخت',
  paymentVoidedNoEffect: 'این پرداخت در تاریخچه مانده، اما در جایگاه مالی خانواده اثری ندارد.',
  paymentRecordedAt: 'زمان ثبت',
  paymentRecordedBy: 'شناسهٔ ثبت‌کننده',
  paymentVoidedAt: 'زمان ابطال',
  paymentVoidedBy: 'شناسهٔ ابطال‌کننده',
  paymentVoidReason: 'دلیل ابطال',
  paymentVoidTitle: 'اصلاح پرداخت ثبت‌شده',
  paymentVoidHelp: 'سابقهٔ پرداخت حفظ می‌شود و با دلیل شما به‌عنوان باطل‌شده در تاریخچه می‌ماند.',
  paymentVoidAction: 'ثبت ابطال پرداخت',
  paymentCreatedSuccess: 'پرداخت دریافتی برای خانواده ثبت شد.',
  paymentVoidedSuccess: 'پرداخت باطل شد و در تاریخچه باقی ماند.',

  // --- family payment promises -------------------------------------------

  promisePageTitle: 'قول‌های پرداخت خانواده',
  promisePageDescription:
    'پیگیری قول‌های پرداخت؛ قول پرداخت خودش پرداخت یا بدهی نیست و جایگاه مالی را تغییر نمی‌دهد.',
  promiseCreateTitle: 'ثبت قول پرداخت',
  promiseCreateHelp:
    'مبلغ و روزی را ثبت کنید که خانواده قول داده است. ثبت دیرهنگام با تاریخ گذشته مجاز است.',
  promiseAmount: 'مبلغ قول (تومان)',
  promiseDueOn: 'تاریخ سررسید',
  promiseDueOnHelp: 'روزی که خانواده قول پرداخت داده است.',
  promiseNote: 'یادداشت پیگیری',
  promiseNoteHelp: 'اختیاری؛ حداکثر ۲۰۰۰ نویسه.',
  promiseCreateAction: 'ثبت قول',
  promiseHistoryTitle: 'پیگیری و تاریخچهٔ قول‌ها',
  promiseHistoryEmpty: 'در این فیلتر، قولی ثبت نشده است.',
  promiseFiltersTitle: 'فیلتر وضعیت قول‌ها',
  promiseFulfillTitle: 'ثبت انجام قول',
  promiseFulfillHelp:
    'فقط پرداخت‌های تأییدشده با مبلغ کافی نشان داده می‌شوند. اتصال نهایی را سرور بررسی می‌کند.',
  promiseFulfillPayment: 'پرداخت تأییدشده',
  promiseFulfillAction: 'ثبت انجام قول',
  promiseNoCandidatePayment: 'در پرداخت‌های اخیر، پرداخت تأییدشده با مبلغ کافی پیدا نشد.',
  promiseRescheduleTitle: 'موکول‌کردن به تاریخ جدید',
  promiseRescheduleHelp: 'ردیف فعلی در تاریخچه می‌ماند و قول جایگزین با همان مبلغ ساخته می‌شود.',
  promiseNewDueOn: 'تاریخ جدید',
  promiseReason: 'دلیل',
  promiseRescheduleAction: 'ثبت تاریخ جدید',
  promiseCancelTitle: 'پایان پیگیری این قول',
  promiseCancelHelp: 'این کار حذف نیست؛ قول با دلیل در تاریخچه می‌ماند و اثر مالی ندارد.',
  promiseCancelAction: 'ثبت پایان پیگیری',
  promiseCreatedSuccess: 'قول پرداخت ثبت شد.',
  promiseFulfilledSuccess: 'انجام قول با پرداخت انتخابی ثبت شد.',
  promiseRescheduledSuccess: 'قول به تاریخ جدید موکول شد و ردیف قبلی در تاریخچه ماند.',
  promiseCancelledSuccess: 'پایان پیگیری ثبت شد و قول در تاریخچه ماند.',

  appointmentChargeTitle: 'وضعیت مالی جلسه',
  appointmentChargePosted: 'هزینه ثبت شده',
  appointmentChargeOriginal: 'مبلغ اولیه',
  appointmentChargeEffective: 'مبلغ مؤثر',
  appointmentChargeFree: 'هزینهٔ رایگان ثبت شده',
  appointmentChargeFullyAdjusted: 'تعرفهٔ مبلغ‌دار، تخفیف کامل',
  appointmentChargeUnpriced: 'نیازمند اصلاح تعرفه',
  appointmentChargeUnpricedHelp:
    'این جلسه انجام شده و کودک حاضر بوده است، اما تعرفهٔ قابل اعمالی پیدا نشده؛ بنابراین هیچ مبلغی حدس زده یا به‌عنوان صفر ثبت نشده است.',
  appointmentChargeRepostHelp:
    'پس از اصلاح تعرفه، ثبت دوباره را بزنید تا مبلغ فقط در سرور تعیین و ثبت شود.',
  appointmentChargeReady: 'آمادهٔ ثبت هزینه',
  appointmentChargeReadyHelp:
    'جلسه واجد شرایط است و تعرفه پیدا شده، اما هنوز هزینهٔ معتبری برای آن ثبت نشده است.',
  appointmentChargePostAction: 'ثبت دوبارهٔ هزینه',
  appointmentChargeNotChargeable: 'بدون هزینهٔ قابل ثبت',
  appointmentChargeNotChargeableHelp:
    'این وضعیت خطای قیمت‌گذاری نیست؛ جلسه هنوز واجد شرایط ثبت هزینه نیست یا حضور کودک ثبت نشده است.',
  appointmentChargeNoShowHelp: 'برای عدم حضور کودک هزینه‌ای ثبت نمی‌شود.',
  appointmentChargeCancelledHelp: 'برای نوبت لغوشده هزینه‌ای ثبت نمی‌شود.',
  appointmentChargeVoidedHistory: 'هزینهٔ تاریخی باطل‌شده',
  appointmentChargeVoidedHelp: 'این ردیف فقط سابقه است و اثر مالی جاری ندارد.',
  appointmentChargeUnavailable: 'وضعیت هزینه در حال حاضر قابل دریافت نیست.',
  appointmentDayCharged: 'هزینه ثبت شده',
  appointmentDayUnpriced: 'نیازمند تعرفه',

  duplicateTitle: 'بررسی موارد مشابه',
  duplicateFamilyIntro:
    'اطلاعاتی که وارد کردید با یک یا چند خانوادهٔ ثبت‌شده مشابهت دارد. هر مورد را بررسی کنید؛ اگر مطمئن هستید خانوادهٔ تکراری نیست، آن را تأیید کنید و دوباره ثبت را بزنید.',
  duplicateChildIntro:
    'اطلاعاتی که وارد کردید با یک کودک ثبت‌شده در همین خانواده مشابهت دارد. اگر مطمئن هستید فرد دیگری است، آن را تأیید کنید و دوباره ثبت را بزنید.',
  duplicateAcknowledgeLabel: 'این مورد را بررسی کردم؛ رکورد متفاوتی است.',
  duplicateConfirmAction: 'تأیید و ثبت',
  duplicateDiscardAction: 'انصراف',
  duplicateBlockingBadge: 'نیاز به بررسی',
  duplicateInfoBadge: 'مشابه',
  duplicateExpiredNotice: 'این درخواست دیگر معتبر نیست. اطلاعات را دوباره وارد کنید.',
  duplicateChildrenInFamilyLabel: 'کودکان این خانواده',

  // --- clinic day and appointment lifecycle --------------------------------

  appointmentsTitle: 'نوبت‌های روز',
  appointmentsDescription: 'برنامهٔ یک روز کلینیک و نتیجهٔ ثبت‌شدهٔ هر جلسه.',
  appointmentDetailTitle: 'جزئیات نوبت',
  appointmentDayAgendaTitle: 'برنامهٔ روز',
  appointmentDayEmpty: 'برای این روز و فیلترهای انتخاب‌شده نوبتی ثبت نشده است.',
  appointmentDayFailure: 'برنامهٔ روز بارگیری نشد. فیلترها را بررسی کنید یا دوباره تلاش کنید.',
  appointmentFiltersTitle: 'فیلتر برنامه',
  appointmentDateNavLabel: 'انتخاب روز برنامهٔ کلینیک',
  appointmentToday: 'امروز',
  appointmentPreviousWeek: 'هفتهٔ قبل',
  appointmentNextWeek: 'هفتهٔ بعد',
  appointmentAllTherapists: 'همهٔ درمانگران',
  appointmentAllRooms: 'همهٔ اتاق‌ها',
  appointmentApplyFilters: 'اعمال فیلتر',
  appointmentClearFilters: 'پاک کردن فیلترها',
  appointmentTotal: 'کل نوبت‌ها',
  appointmentScheduled: 'برنامه‌ریزی‌شده',
  appointmentCompleted: 'انجام‌شده',
  appointmentCancelled: 'لغوشده',
  appointmentUnresolved: 'نتیجهٔ معوق',
  appointmentNoShow: 'عدم حضور',
  appointmentService: 'خدمت',
  appointmentTherapist: 'درمانگر',
  appointmentRoom: 'اتاق',
  appointmentChild: 'کودک',
  appointmentFileNumber: 'پرونده',
  appointmentDuration: 'مدت جلسه',
  appointmentNote: 'یادداشت غیرپزشکی',
  appointmentNoNote: 'یادداشتی ثبت نشده است.',
  appointmentTariffTitle: 'پیشنهاد تعرفه',
  appointmentTariffReadOnly: 'این مبلغ فقط پیشنهاد جاری تعرفه است و در این صفحه قابل تغییر نیست.',
  appointmentTariffMissing:
    'برای این ترکیب تعرفه‌ای پیدا نشد. نوبت معتبر است و ثبت نتیجه یا سایر عملیات متوقف نمی‌شود.',
  appointmentFreeTariff: 'رایگان',
  appointmentMoveTitle: 'جابجایی و ویرایش نوبت',
  appointmentMoveAction: 'جابجایی نوبت',
  appointmentMoveHelp:
    'کودک و خدمت ثابت می‌مانند. زمان، مدت، درمانگر، اتاق و یادداشت با یک جایگاه کامل جایگزین می‌شوند.',
  appointmentStartTime: 'ساعت شروع',
  appointmentAvailabilityOverride: 'دلیل ثبت خارج از برنامهٔ حضور (در صورت نیاز)',
  appointmentAvailabilityOverrideHelp:
    'فقط اگر زمان جدید خارج از برنامهٔ درمانگر است دلیل بنویسید. دلیل در تاریخچه ثبت می‌شود.',
  appointmentCancelTitle: 'لغو نوبت',
  appointmentCancelParty: 'لغوکننده',
  appointmentCancelFamily: 'خانواده',
  appointmentCancelClinic: 'کلینیک',
  appointmentCancelReason: 'دلیل لغو',
  appointmentCancelAction: 'ثبت لغو',
  appointmentCompleteAction: 'ثبت انجام جلسه',
  appointmentAttendanceTitle: 'حضور کودک',
  appointmentAttendedAction: 'ثبت حضور',
  appointmentNoShowAction: 'ثبت عدم حضور',
  appointmentAttendanceCorrection:
    'ثبت گزینهٔ دیگر، نتیجهٔ قبلی را به‌صورت قابل‌ردیابی اصلاح می‌کند.',
  appointmentReopenTitle: 'بازگشایی جلسهٔ انجام‌شده',
  appointmentReopenReason: 'دلیل بازگشایی',
  appointmentReopenAction: 'بازگشایی نوبت',
  appointmentManagerOnly: 'این اصلاح فقط در اختیار مدیر است و دلیل آن در تاریخچه ثبت می‌شود.',
  appointmentCancellationReason: 'دلیل لغو',
  appointmentAvailabilityOverridden: 'خارج از برنامهٔ حضور ثبت شده',
  appointmentMoved: 'نوبت با موفقیت جابجا شد.',
  appointmentCancelledSuccess: 'لغو نوبت ثبت شد.',
  appointmentCompletedSuccess: 'انجام جلسه ثبت شد.',
  appointmentAttendanceSuccess: 'نتیجهٔ حضور ثبت شد.',
  appointmentReopenedSuccess: 'نوبت با دلیل ثبت‌شده بازگشایی شد.',
} as const;

export type CopyKey = keyof typeof COPY;

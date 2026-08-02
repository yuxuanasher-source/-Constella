"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import {
  normalizePublishedBrand,
  type PublishedOrganizationBrand,
} from "@/features/organizations/organization-brand";
import type {
  OrganizationBrandSource,
  OrganizationBrandStudioDto,
  OrganizationContactCardDto,
} from "@/features/organizations/organization-brand-service";

import styles from "./brand-center.module.css";
import { OrganizationBrandMark } from "./organization-brand-mark";

type DraftState = NonNullable<OrganizationBrandStudioDto["draft"]>;
type AsyncState = "idle" | "working" | "success" | "error" | "conflict";
type PreviewKind = "internal" | "public";
type ContactForm = {
  displayName: string;
  title: string;
  phone: string;
  email: string;
  wechat: string;
};
type ConflictState = {
  latestVersion: number;
  online: PublishedOrganizationBrand;
};

type BrandFieldKey = "logoText" | "brandName" | "brandTagline" | "primaryColor";
type BrandLogoClientErrorCode =
  | "BRAND_LOGO_INVALID_FILE"
  | "BRAND_LOGO_TOO_LARGE"
  | "BRAND_LOGO_INVALID_CONTENT"
  | "BRAND_LOGO_PREPARATION_UNAVAILABLE"
  | "BRAND_LOGO_UPLOAD_FAILED"
  | "ORGANIZATION_BRAND_LOGO_UNAVAILABLE"
  | "UNKNOWN";

export type OrganizationBrandCenterProps = {
  initialStudio: OrganizationBrandStudioDto;
  canEdit: boolean;
  initialLogoUrls: { published: string | null; draft: string | null };
};

const emptyContactForm: ContactForm = {
  displayName: "",
  title: "",
  phone: "",
  email: "",
  wechat: "",
};

const BRAND_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const BRAND_LOGO_MAX_INPUT_PIXELS = 16_777_216;
const BRAND_LOGO_MAX_OUTPUT_EDGE = 1024;
const BRAND_LOGO_WEBP_QUALITY = 0.88;
const allowedBrandLogoTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const fieldErrorIds: Record<BrandFieldKey, string> = {
  logoText: "brand-logo-text-error",
  brandName: "brand-name-error",
  brandTagline: "brand-tagline-error",
  primaryColor: "brand-primary-color-error",
};

class BrandLogoClientError extends Error {
  constructor(readonly code: BrandLogoClientErrorCode) {
    super(code);
    this.name = "BrandLogoClientError";
  }
}

export async function prepareBrandLogoForUpload(file: File): Promise<File> {
  if (!allowedBrandLogoTypes.has(file.type) || file.size <= 0) {
    throw new BrandLogoClientError("BRAND_LOGO_INVALID_FILE");
  }
  if (file.size > BRAND_LOGO_MAX_BYTES) {
    throw new BrandLogoClientError("BRAND_LOGO_TOO_LARGE");
  }
  if (
    typeof globalThis.createImageBitmap !== "function" ||
    typeof document === "undefined"
  ) {
    throw new BrandLogoClientError("BRAND_LOGO_PREPARATION_UNAVAILABLE");
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await globalThis.createImageBitmap(file);
  } catch {
    throw new BrandLogoClientError("BRAND_LOGO_INVALID_CONTENT");
  }

  try {
    if (
      !Number.isFinite(bitmap.width) ||
      !Number.isFinite(bitmap.height) ||
      bitmap.width <= 0 ||
      bitmap.height <= 0 ||
      bitmap.width * bitmap.height > BRAND_LOGO_MAX_INPUT_PIXELS
    ) {
      throw new BrandLogoClientError("BRAND_LOGO_INVALID_CONTENT");
    }
    const sourceEdge = Math.min(bitmap.width, bitmap.height);
    const outputEdge = Math.min(sourceEdge, BRAND_LOGO_MAX_OUTPUT_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = outputEdge;
    canvas.height = outputEdge;
    const context = canvas.getContext("2d");
    if (!context || typeof canvas.toBlob !== "function") {
      throw new BrandLogoClientError("BRAND_LOGO_PREPARATION_UNAVAILABLE");
    }
    context.drawImage(
      bitmap,
      (bitmap.width - sourceEdge) / 2,
      (bitmap.height - sourceEdge) / 2,
      sourceEdge,
      sourceEdge,
      0,
      0,
      outputEdge,
      outputEdge,
    );
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new BrandLogoClientError("BRAND_LOGO_INVALID_CONTENT")),
        "image/webp",
        BRAND_LOGO_WEBP_QUALITY,
      );
    });
    if (blob.size > BRAND_LOGO_MAX_BYTES) {
      throw new BrandLogoClientError("BRAND_LOGO_TOO_LARGE");
    }
    const baseName = file.name.replace(/\.[^.]+$/u, "").trim() || "logo";
    return new File([blob], `${baseName}.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } catch (error) {
    if (error instanceof BrandLogoClientError) throw error;
    throw new BrandLogoClientError("BRAND_LOGO_INVALID_CONTENT");
  } finally {
    bitmap.close();
  }
}

const brandFields: Array<{
  key: keyof OrganizationBrandSource;
  label: string;
}> = [
  { key: "logoText", label: "LOGO 字标" },
  { key: "logoStoragePath", label: "LOGO 图片" },
  { key: "brandName", label: "品牌名称" },
  { key: "brandTagline", label: "品牌副标" },
  { key: "primaryColor", label: "品牌主色" },
];

export function OrganizationBrandCenter({
  initialStudio,
  canEdit,
  initialLogoUrls,
}: OrganizationBrandCenterProps) {
  const initialDraft = initialStudio.draft ?? {
    baseVersion: initialStudio.published.version,
    content: sourceFromPublished(initialStudio.published),
    persisted: false,
    updatedAt: null,
  };
  const [published, setPublished] = useState(initialStudio.published);
  const [draft, setDraft] = useState<DraftState>(initialDraft);
  const [cards, setCards] = useState(initialStudio.contactCards);
  const [selectedPreview, setSelectedPreview] =
    useState<PreviewKind>("internal");
  const [saveState, setSaveState] = useState<AsyncState>("idle");
  const [publishState, setPublishState] = useState<AsyncState>("idle");
  const [announcement, setAnnouncement] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [draftDirty, setDraftDirty] = useState(false);
  const [publishConfirmation, setPublishConfirmation] = useState(false);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [uploadState, setUploadState] = useState<
    "idle" | "uploading" | "success" | "cancelled" | "error"
  >("idle");
  const [publishedLogoUrl, setPublishedLogoUrl] = useState(
    initialLogoUrls.published,
  );
  const [draftLogoUrl, setDraftLogoUrl] = useState(
    initialLogoUrls.draft ??
      (initialDraft.content.logoStoragePath ===
      initialStudio.published.logoStoragePath
        ? initialLogoUrls.published
        : null),
  );
  const [provisionalLogoUrl, setProvisionalLogoUrl] = useState<string | null>(
    null,
  );
  const [publishedByLabel, setPublishedByLabel] = useState<string | null>(() =>
    canEdit
      ? (initialStudio.versions?.find(
          (version) => version.version === initialStudio.published.version,
        )?.publishedByLabel ?? "历史发布记录")
      : null,
  );
  const uploadController = useRef<AbortController | null>(null);
  const publishedLogoUrlRef = useRef(publishedLogoUrl);
  const draftLogoUrlRef = useRef(draftLogoUrl);
  const provisionalLogoUrlRef = useRef<string | null>(null);
  const ownedLogoUrlsRef = useRef(new Set<string>());
  const brandInputRefs = useRef<Record<BrandFieldKey, HTMLInputElement | null>>(
    {
      logoText: null,
      brandName: null,
      brandTagline: null,
      primaryColor: null,
    },
  );
  const [newCard, setNewCard] = useState<ContactForm>(emptyContactForm);
  const [cardForms, setCardForms] = useState<Record<string, ContactForm>>(() =>
    Object.fromEntries(
      initialStudio.contactCards.map((card) => [card.id, formFromCard(card)]),
    ),
  );
  const [cardBusyId, setCardBusyId] = useState<string | null>(null);
  const [emergencyForms, setEmergencyForms] = useState<
    Record<string, { reason: string; acknowledged: boolean }>
  >({});

  useEffect(() => {
    const ownedLogoUrls = ownedLogoUrlsRef.current;
    return () => {
      uploadController.current?.abort();
      for (const url of ownedLogoUrls) {
        URL.revokeObjectURL(url);
      }
      ownedLogoUrls.clear();
    };
  }, []);

  const previewBrand = useMemo(() => {
    const source = canEdit ? draft.content : sourceFromPublished(published);
    return normalizePublishedBrand(
      {
        ...source,
        version: published.version,
        publishedAt: published.publishedAt,
      },
      {
        organizationId: initialStudio.organization.id,
        organizationName: initialStudio.organization.name,
      },
    );
  }, [
    canEdit,
    draft.content,
    initialStudio.organization.id,
    initialStudio.organization.name,
    published,
  ]);
  const previewLogoUrl = canEdit
    ? (provisionalLogoUrl ?? draftLogoUrl)
    : publishedLogoUrl;

  const updateDraftField = <K extends keyof OrganizationBrandSource>(
    key: K,
    value: OrganizationBrandSource[K],
  ) => {
    setDraft((current) => ({
      ...current,
      content: { ...current.content, [key]: value },
    }));
    setDraftDirty(true);
    setPublishConfirmation(false);
    setSaveState("idle");
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const createOwnedLogoUrl = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    ownedLogoUrlsRef.current.add(url);
    return url;
  };

  const revokeOwnedLogoUrl = (url: string | null) => {
    if (url && ownedLogoUrlsRef.current.delete(url)) {
      URL.revokeObjectURL(url);
    }
  };

  const clearProvisionalLogoUrl = () => {
    const current = provisionalLogoUrlRef.current;
    provisionalLogoUrlRef.current = null;
    setProvisionalLogoUrl(null);
    revokeOwnedLogoUrl(current);
  };

  const installProvisionalLogoUrl = (url: string) => {
    provisionalLogoUrlRef.current = url;
    setProvisionalLogoUrl(url);
  };

  const validateDraft = () => {
    const errors: Record<string, string> = {};
    const logoLength = Array.from(draft.content.logoText.trim()).length;
    const nameLength = Array.from(draft.content.brandName.trim()).length;
    const taglineLength = Array.from(draft.content.brandTagline.trim()).length;
    if (logoLength < 1) errors.logoText = "LOGO 字标不能为空。";
    if (logoLength > 8) errors.logoText = "LOGO 字标最多 8 个字符。";
    if (nameLength < 1) errors.brandName = "品牌名称不能为空。";
    if (nameLength > 40) errors.brandName = "品牌名称最多 40 个字符。";
    if (taglineLength > 80) errors.brandTagline = "品牌副标最多 80 个字符。";
    if (!/^#[0-9A-F]{6}$/u.test(draft.content.primaryColor.toUpperCase())) {
      errors.primaryColor = "品牌主色需使用 #RRGGBB 格式。";
    }
    setFieldErrors(errors);
    const firstInvalidField = (
      ["logoText", "brandName", "brandTagline", "primaryColor"] as const
    ).find((field) => Boolean(errors[field]));
    if (firstInvalidField) {
      setAnnouncement(`品牌资料校验失败：${errors[firstInvalidField]}`);
      brandInputRefs.current[firstInvalidField]?.focus();
      return false;
    }
    return true;
  };

  const handleLogoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    uploadController.current?.abort();
    clearProvisionalLogoUrl();
    const rawUrl = createOwnedLogoUrl(file);
    let uploadPreviewUrl = rawUrl;
    installProvisionalLogoUrl(rawUrl);
    const controller = new AbortController();
    uploadController.current = controller;
    setUploadState("uploading");
    setAnnouncement("LOGO 正在上传，可随时取消。");

    try {
      const preparedFile = await prepareBrandLogoForUpload(file);
      if (controller.signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const preparedUrl = createOwnedLogoUrl(preparedFile);
      clearProvisionalLogoUrl();
      uploadPreviewUrl = preparedUrl;
      installProvisionalLogoUrl(preparedUrl);
      const body = new FormData();
      body.append("logo", preparedFile);
      const response = await fetch("/api/organization/brand/logo", {
        method: "POST",
        body,
        signal: controller.signal,
      });
      const payload = (await safeJson(response)) as {
        code?: unknown;
        logoStoragePath?: unknown;
      };
      if (controller.signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      if (!response.ok || typeof payload.logoStoragePath !== "string") {
        throw new BrandLogoClientError(
          normalizeBrandLogoErrorCode(payload.code),
        );
      }
      const previousDraftUrl = draftLogoUrlRef.current;
      if (
        previousDraftUrl !== preparedUrl &&
        previousDraftUrl !== publishedLogoUrlRef.current
      ) {
        revokeOwnedLogoUrl(previousDraftUrl);
      }
      draftLogoUrlRef.current = preparedUrl;
      setDraftLogoUrl(preparedUrl);
      provisionalLogoUrlRef.current = null;
      setProvisionalLogoUrl(null);
      updateDraftField("logoStoragePath", payload.logoStoragePath);
      setUploadState("success");
      setAnnouncement("上传完成，待保存");
    } catch (error) {
      if (isAbortError(error)) {
        setUploadState("cancelled");
        setAnnouncement("上传已取消，本地草稿已保留。");
      } else {
        setUploadState("error");
        setAnnouncement(brandLogoErrorMessage(error));
      }
      if (provisionalLogoUrlRef.current === uploadPreviewUrl) {
        clearProvisionalLogoUrl();
      } else {
        revokeOwnedLogoUrl(uploadPreviewUrl);
      }
    } finally {
      if (uploadController.current === controller)
        uploadController.current = null;
      event.target.value = "";
    }
  };

  const loadConflict = async (response: Response) => {
    const errorPayload = (await safeJson(response)) as {
      latestVersion?: unknown;
    };
    const refresh = await fetch("/api/organization/brand", { method: "GET" });
    const refreshPayload = (await safeJson(refresh)) as {
      studio?: {
        published?: PublishedOrganizationBrand;
        versions?: OrganizationBrandStudioDto["versions"];
      };
    };
    const online = refreshPayload.studio?.published;
    if (!refresh.ok || !online) throw new Error("refresh_failed");
    const latestVersion =
      typeof errorPayload.latestVersion === "number" &&
      Number.isInteger(errorPayload.latestVersion)
        ? errorPayload.latestVersion
        : online.version;
    const previousPublishedLogoUrl = publishedLogoUrlRef.current;
    if (online.logoStoragePath !== published.logoStoragePath) {
      publishedLogoUrlRef.current = null;
      setPublishedLogoUrl(null);
      if (previousPublishedLogoUrl !== draftLogoUrlRef.current) {
        revokeOwnedLogoUrl(previousPublishedLogoUrl);
      }
    }
    setPublished(online);
    setPublishedByLabel(
      refreshPayload.studio?.versions?.find(
        (version) => version.version === online.version,
      )?.publishedByLabel ?? "其他组织负责人",
    );
    setConflict({ latestVersion, online });
    setSaveState("conflict");
    setPublishState("conflict");
    setPublishConfirmation(false);
    setAnnouncement(`检测到线上新版本 v${latestVersion}`);
  };

  const saveDraft = async () => {
    if (!validateDraft() || conflict) return;
    setSaveState("working");
    setAnnouncement("正在保存草稿。");
    try {
      const response = await fetch("/api/organization/brand", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: draft.baseVersion,
          logoText: draft.content.logoText.trim(),
          logoStoragePath: draft.content.logoStoragePath,
          brandName: draft.content.brandName.trim(),
          brandTagline: draft.content.brandTagline.trim(),
          primaryColor: draft.content.primaryColor.toUpperCase(),
        }),
      });
      if (response.status === 409) {
        await loadConflict(response);
        return;
      }
      const payload = (await safeJson(response)) as { draft?: DraftState };
      if (!response.ok || !payload.draft) throw new Error("save_failed");
      setDraft(payload.draft);
      setDraftDirty(false);
      setSaveState("success");
      setAnnouncement("草稿已保存，尚未发布。");
    } catch {
      setSaveState("error");
      setAnnouncement("草稿保存失败，请重试。");
    }
  };

  const publishDraft = async () => {
    if (draftDirty || conflict || !validateDraft()) return;
    setPublishState("working");
    setAnnouncement("正在发布品牌草稿。");
    try {
      const response = await fetch("/api/organization/brand/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: draft.baseVersion }),
      });
      if (response.status === 409) {
        await loadConflict(response);
        return;
      }
      const payload = (await safeJson(response)) as {
        version?: number;
        published?: PublishedOrganizationBrand;
      };
      if (
        !response.ok ||
        !payload.published ||
        typeof payload.version !== "number"
      ) {
        throw new Error("publish_failed");
      }
      const nextSource = sourceFromPublished(payload.published);
      const previousPublishedLogoUrl = publishedLogoUrlRef.current;
      const previousDraftLogoUrl = draftLogoUrlRef.current;
      const nextPublishedLogoUrl = payload.published.logoStoragePath
        ? payload.published.logoStoragePath === published.logoStoragePath
          ? previousPublishedLogoUrl
          : payload.published.logoStoragePath === draft.content.logoStoragePath
            ? previousDraftLogoUrl
            : null
        : null;
      publishedLogoUrlRef.current = nextPublishedLogoUrl;
      draftLogoUrlRef.current = nextPublishedLogoUrl;
      setPublishedLogoUrl(nextPublishedLogoUrl);
      setDraftLogoUrl(nextPublishedLogoUrl);
      if (previousPublishedLogoUrl !== nextPublishedLogoUrl) {
        revokeOwnedLogoUrl(previousPublishedLogoUrl);
      }
      if (
        previousDraftLogoUrl !== nextPublishedLogoUrl &&
        previousDraftLogoUrl !== previousPublishedLogoUrl
      ) {
        revokeOwnedLogoUrl(previousDraftLogoUrl);
      }
      setPublished(payload.published);
      setPublishedByLabel("你");
      setDraft({
        baseVersion: payload.version,
        content: nextSource,
        persisted: false,
        updatedAt: null,
      });
      setDraftDirty(false);
      setPublishConfirmation(false);
      setPublishState("success");
      setSaveState("idle");
      setAnnouncement(`品牌已发布为 v${payload.version}。`);
    } catch {
      setPublishState("error");
      setAnnouncement("品牌发布失败，线上版本未改变，请重试。");
    }
  };

  const removeDraftLogo = () => {
    uploadController.current?.abort();
    clearProvisionalLogoUrl();
    const previousDraftLogoUrl = draftLogoUrlRef.current;
    draftLogoUrlRef.current = null;
    setDraftLogoUrl(null);
    if (previousDraftLogoUrl !== publishedLogoUrlRef.current) {
      revokeOwnedLogoUrl(previousDraftLogoUrl);
    }
    updateDraftField("logoStoragePath", null);
    setUploadState("idle");
    setAnnouncement("草稿 LOGO 已移除，保存并发布后生效。");
  };

  const acceptConflictVersion = () => {
    if (!conflict) return;
    setDraft((current) => ({
      ...current,
      baseVersion: conflict.latestVersion,
    }));
    // The persisted server draft still targets the previous publication.
    // Require an atomic save against the adopted version before retrying.
    setDraftDirty(true);
    setConflict(null);
    setSaveState("idle");
    setPublishState("idle");
    setPublishConfirmation(false);
    setAnnouncement(
      "已采用线上版本号；本地草稿未被覆盖，请重新保存并确认发布。",
    );
  };

  const createCard = async (event: FormEvent) => {
    event.preventDefault();
    if (!newCard.displayName.trim() || !hasContact(newCard)) {
      setAnnouncement("联系名片需填写姓名和至少一种公开联系方式。");
      return;
    }
    setCardBusyId("new");
    try {
      const response = await fetch("/api/organization/contact-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contactPayload(newCard)),
      });
      const payload = (await safeJson(response)) as {
        contactCard?: OrganizationContactCardDto;
      };
      if (!response.ok || !payload.contactCard)
        throw new Error("create_failed");
      setCards((current) => [...current, payload.contactCard!]);
      setCardForms((current) => ({
        ...current,
        [payload.contactCard!.id]: formFromCard(payload.contactCard!),
      }));
      setNewCard(emptyContactForm);
      setAnnouncement("联系名片已创建。");
    } catch {
      setAnnouncement("联系名片创建失败，请重试。");
    } finally {
      setCardBusyId(null);
    }
  };

  const updateCard = async (card: OrganizationContactCardDto) => {
    const form = cardForms[card.id] ?? formFromCard(card);
    if (!form.displayName.trim() || !hasContact(form)) {
      setAnnouncement("联系名片需填写姓名和至少一种公开联系方式。");
      return;
    }
    await patchCard(card, contactPayload(form), "联系名片已更新。");
  };

  const toggleCardStatus = async (card: OrganizationContactCardDto) => {
    const status = card.status === "active" ? "disabled" : "active";
    await patchCard(
      card,
      { status },
      status === "active" ? "联系名片已启用。" : "联系名片已停用。",
    );
  };

  const patchCard = async (
    card: OrganizationContactCardDto,
    changes: Record<string, unknown>,
    successMessage: string,
  ) => {
    setCardBusyId(card.id);
    try {
      const response = await fetch(
        `/api/organization/contact-cards/${card.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(changes),
        },
      );
      const payload = (await safeJson(response)) as {
        contactCard?: OrganizationContactCardDto;
      };
      if (!response.ok || !payload.contactCard)
        throw new Error("update_failed");
      setCards((current) =>
        current.map((item) =>
          item.id === payload.contactCard!.id ? payload.contactCard! : item,
        ),
      );
      setCardForms((current) => ({
        ...current,
        [payload.contactCard!.id]: formFromCard(payload.contactCard!),
      }));
      setAnnouncement(successMessage);
    } catch {
      setAnnouncement("联系名片更新失败，请重试。");
    } finally {
      setCardBusyId(null);
    }
  };

  const emergencyRemove = async (card: OrganizationContactCardDto) => {
    const form = emergencyForms[card.id] ?? { reason: "", acknowledged: false };
    if (!form.reason.trim() || !form.acknowledged) return;
    setCardBusyId(card.id);
    try {
      const response = await fetch(
        `/api/organization/contact-cards/${card.id}/emergency-remove`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: form.reason.trim() }),
        },
      );
      const payload = (await safeJson(response)) as {
        affectedActiveShareCount?: unknown;
      };
      if (
        !response.ok ||
        typeof payload.affectedActiveShareCount !== "number"
      ) {
        throw new Error("emergency_failed");
      }
      setAnnouncement(
        `已从 ${payload.affectedActiveShareCount} 个有效分享中移除。`,
      );
      setEmergencyForms((current) => ({
        ...current,
        [card.id]: { reason: "", acknowledged: false },
      }));
    } catch {
      setAnnouncement("紧急移除失败，请核对原因后重试。");
    } finally {
      setCardBusyId(null);
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>品牌中心</h1>
          <p>统一治理组织在内部工作台和对外分享中的品牌呈现。</p>
        </div>
        <div className={styles.onlineStatus}>
          <strong>当前线上版本 v{published.version}</strong>
          <span>{formatPublishedAt(published.publishedAt)}</span>
        </div>
      </header>

      <div className={styles.liveRegion} role="status" aria-live="polite">
        {announcement}
      </div>

      <div className={styles.workspace}>
        <div className={styles.governanceColumn}>
          <section
            className={styles.summarySection}
            aria-labelledby="current-brand-title"
          >
            <div className={styles.sectionHeading}>
              <div>
                <h2 id="current-brand-title">
                  {canEdit ? "当前线上版本" : "当前已发布品牌"}
                </h2>
                <p>
                  {canEdit
                    ? `发布者 ${publishedByLabel} · ${formatDate(published.publishedAt)}`
                    : `发布于 ${formatDate(published.publishedAt)}`}
                </p>
              </div>
              <span className={styles.versionBadge}>v{published.version}</span>
            </div>
            <div className={styles.brandSummary}>
              <OrganizationBrandMark
                brandName={published.brandName}
                logoText={published.logoText}
                logoUrl={publishedLogoUrl}
                className={styles.summaryMark}
              />
              <div>
                <strong>{published.brandName}</strong>
                <span>{published.brandTagline || "未设置品牌副标"}</span>
              </div>
            </div>
          </section>

          {canEdit ? (
            <>
              <section
                className={styles.editorSection}
                aria-labelledby="draft-title"
              >
                <div className={styles.sectionHeading}>
                  <div>
                    <h2 id="draft-title">未发布草稿</h2>
                    <p>
                      基于线上 v{draft.baseVersion} ·{" "}
                      {draft.persisted ? "已保存" : "初始草稿"}
                    </p>
                  </div>
                  {draftDirty ? (
                    <span className={styles.pendingBadge}>待保存</span>
                  ) : null}
                </div>

                <div className={styles.logoEditor}>
                  <OrganizationBrandMark
                    brandName={draft.content.brandName}
                    logoText={draft.content.logoText}
                    logoUrl={previewLogoUrl}
                    className={styles.editorMark}
                  />
                  <div className={styles.uploadControls}>
                    <label className={styles.fileButton}>
                      <span>上传 LOGO</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        aria-label="上传 LOGO 图片"
                        onChange={handleLogoUpload}
                        disabled={uploadState === "uploading"}
                      />
                    </label>
                    {uploadState === "uploading" ? (
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => uploadController.current?.abort()}
                      >
                        取消上传
                      </button>
                    ) : null}
                    {draft.content.logoStoragePath || previewLogoUrl ? (
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={removeDraftLogo}
                      >
                        移除草稿 LOGO
                      </button>
                    ) : null}
                    <span className={styles.fieldHint}>
                      JPEG、PNG 或 WebP，服务端会校验并规范化。
                    </span>
                  </div>
                </div>
                {uploadState === "success" ? (
                  <p className={styles.successText}>上传完成，待保存</p>
                ) : null}
                {uploadState === "cancelled" ? (
                  <p className={styles.fieldHint}>
                    上传已取消，本地草稿已保留。
                  </p>
                ) : null}

                <div className={styles.fieldGrid}>
                  <BrandField
                    label="LOGO 字标"
                    error={fieldErrors.logoText}
                    errorId={fieldErrorIds.logoText}
                  >
                    <input
                      ref={(node) => {
                        brandInputRefs.current.logoText = node;
                      }}
                      aria-label="LOGO 字标"
                      value={draft.content.logoText}
                      onChange={(event) =>
                        updateDraftField("logoText", event.target.value)
                      }
                      aria-invalid={Boolean(fieldErrors.logoText)}
                      aria-describedby={
                        fieldErrors.logoText
                          ? fieldErrorIds.logoText
                          : undefined
                      }
                    />
                  </BrandField>
                  <BrandField
                    label="品牌名称"
                    error={fieldErrors.brandName}
                    errorId={fieldErrorIds.brandName}
                    wide
                  >
                    <input
                      ref={(node) => {
                        brandInputRefs.current.brandName = node;
                      }}
                      aria-label="品牌名称"
                      value={draft.content.brandName}
                      onChange={(event) =>
                        updateDraftField("brandName", event.target.value)
                      }
                      aria-invalid={Boolean(fieldErrors.brandName)}
                      aria-describedby={
                        fieldErrors.brandName
                          ? fieldErrorIds.brandName
                          : undefined
                      }
                    />
                  </BrandField>
                  <BrandField
                    label="品牌副标"
                    error={fieldErrors.brandTagline}
                    errorId={fieldErrorIds.brandTagline}
                    wide
                  >
                    <input
                      ref={(node) => {
                        brandInputRefs.current.brandTagline = node;
                      }}
                      aria-label="品牌副标"
                      value={draft.content.brandTagline}
                      onChange={(event) =>
                        updateDraftField("brandTagline", event.target.value)
                      }
                      aria-invalid={Boolean(fieldErrors.brandTagline)}
                      aria-describedby={
                        fieldErrors.brandTagline
                          ? fieldErrorIds.brandTagline
                          : undefined
                      }
                    />
                  </BrandField>
                  <BrandField
                    label="品牌主色"
                    error={fieldErrors.primaryColor}
                    errorId={fieldErrorIds.primaryColor}
                  >
                    <div className={styles.colorControl}>
                      <input
                        type="color"
                        aria-label="选择品牌主色"
                        value={
                          /^#[0-9A-F]{6}$/u.test(
                            draft.content.primaryColor.toUpperCase(),
                          )
                            ? draft.content.primaryColor
                            : "#165DFF"
                        }
                        onChange={(event) =>
                          updateDraftField(
                            "primaryColor",
                            event.target.value.toUpperCase(),
                          )
                        }
                      />
                      <input
                        ref={(node) => {
                          brandInputRefs.current.primaryColor = node;
                        }}
                        aria-label="品牌主色"
                        value={draft.content.primaryColor}
                        onChange={(event) =>
                          updateDraftField("primaryColor", event.target.value)
                        }
                        aria-invalid={Boolean(fieldErrors.primaryColor)}
                        aria-describedby={
                          fieldErrors.primaryColor
                            ? fieldErrorIds.primaryColor
                            : undefined
                        }
                      />
                    </div>
                  </BrandField>
                </div>

                {conflict ? (
                  <ConflictPanel
                    conflict={conflict}
                    local={draft.content}
                    onAccept={acceptConflictVersion}
                  />
                ) : null}

                <div className={styles.actionRow}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={saveDraft}
                    disabled={saveState === "working" || Boolean(conflict)}
                  >
                    {saveState === "working" ? "保存中…" : "保存草稿"}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => setPublishConfirmation(true)}
                    disabled={
                      publishState === "working" ||
                      draftDirty ||
                      Boolean(conflict)
                    }
                    title={draftDirty ? "请先保存草稿" : undefined}
                  >
                    准备发布
                  </button>
                </div>

                {publishConfirmation ? (
                  <div className={styles.publishConfirmation}>
                    <strong>确认发布当前草稿？</strong>
                    <p>只影响新页面刷新和新分享，已有分享保留原快照</p>
                    <div className={styles.actionRow}>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={publishDraft}
                        disabled={publishState === "working"}
                      >
                        {publishState === "working"
                          ? "发布中…"
                          : "确认发布草稿"}
                      </button>
                      <button
                        type="button"
                        className={styles.textButton}
                        onClick={() => setPublishConfirmation(false)}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : null}
              </section>

              <ContactCardManager
                cards={cards}
                newCard={newCard}
                setNewCard={setNewCard}
                cardForms={cardForms}
                setCardForms={setCardForms}
                busyId={cardBusyId}
                onCreate={createCard}
                onUpdate={updateCard}
                onToggle={toggleCardStatus}
                emergencyForms={emergencyForms}
                setEmergencyForms={setEmergencyForms}
                onEmergency={emergencyRemove}
              />

              {initialStudio.versions?.length ? (
                <details className={styles.historySection}>
                  <summary>发布历史</summary>
                  <ul>
                    {initialStudio.versions.map((version) => (
                      <li key={version.version}>
                        <strong>v{version.version}</strong>
                        <span>
                          {version.publishedByLabel} ·{" "}
                          {formatDate(version.publishedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : (
            <ReadOnlyContacts
              cards={cards.filter((card) => card.status === "active")}
            />
          )}
        </div>

        <aside className={styles.previewColumn} aria-label="品牌预览">
          <div className={styles.previewHeader}>
            <div>
              <h2>品牌应用预览</h2>
              {canEdit ? (
                <p>预览，不会在发布前影响线上</p>
              ) : (
                <p>当前已发布效果</p>
              )}
            </div>
            <div
              className={styles.previewTabs}
              role="group"
              aria-label="预览类型"
            >
              <button
                type="button"
                aria-pressed={selectedPreview === "internal"}
                onClick={() => setSelectedPreview("internal")}
              >
                内部工作台
              </button>
              <button
                type="button"
                aria-pressed={selectedPreview === "public"}
                onClick={() => setSelectedPreview("public")}
              >
                公开分享
              </button>
            </div>
          </div>
          {selectedPreview === "internal" ? (
            <InternalPreview brand={previewBrand} logoUrl={previewLogoUrl} />
          ) : (
            <PublicPreview brand={previewBrand} logoUrl={previewLogoUrl} />
          )}
        </aside>
      </div>
    </main>
  );
}

function BrandField({
  label,
  error,
  errorId,
  wide = false,
  children,
}: {
  label: string;
  error?: string;
  errorId?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={wide ? styles.fieldWide : styles.field}>
      <span>{label}</span>
      {children}
      {error ? (
        <small id={errorId} className={styles.errorText}>
          {error}
        </small>
      ) : null}
    </label>
  );
}

function ConflictPanel({
  conflict,
  local,
  onAccept,
}: {
  conflict: ConflictState;
  local: OrganizationBrandSource;
  onAccept: () => void;
}) {
  const online = sourceFromPublished(conflict.online);
  const differences = brandFields.filter(
    ({ key }) => online[key] !== local[key],
  );
  return (
    <section
      className={styles.conflictPanel}
      aria-labelledby="brand-conflict-title"
    >
      <h3 id="brand-conflict-title">
        检测到线上新版本 v{conflict.latestVersion}
      </h3>
      <p>你的本地草稿已保留。请核对差异，不能直接覆盖线上版本。</p>
      <dl>
        {differences.map(({ key, label }) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>线上：{displayDifference(online[key])}</dd>
            <dd>本地：{displayDifference(local[key])}</dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        className={styles.secondaryButton}
        onClick={onAccept}
      >
        采用线上版本号并重新确认
      </button>
    </section>
  );
}

function ContactCardManager(props: {
  cards: OrganizationContactCardDto[];
  newCard: ContactForm;
  setNewCard: React.Dispatch<React.SetStateAction<ContactForm>>;
  cardForms: Record<string, ContactForm>;
  setCardForms: React.Dispatch<
    React.SetStateAction<Record<string, ContactForm>>
  >;
  busyId: string | null;
  onCreate: (event: FormEvent) => void;
  onUpdate: (card: OrganizationContactCardDto) => void;
  onToggle: (card: OrganizationContactCardDto) => void;
  emergencyForms: Record<string, { reason: string; acknowledged: boolean }>;
  setEmergencyForms: React.Dispatch<
    React.SetStateAction<
      Record<string, { reason: string; acknowledged: boolean }>
    >
  >;
  onEmergency: (card: OrganizationContactCardDto) => void;
}) {
  return (
    <section
      className={styles.contactSection}
      aria-labelledby="contact-manager-title"
    >
      <div className={styles.sectionHeading}>
        <div>
          <h2 id="contact-manager-title">联系名片管理</h2>
          <p>仅活动名片可用于新分享；停用不会改写已有分享快照。</p>
        </div>
      </div>
      <details className={styles.contactDetails}>
        <summary>新建联系名片</summary>
        <form className={styles.contactForm} onSubmit={props.onCreate}>
          <ContactInputs
            prefix="新名片"
            value={props.newCard}
            onChange={props.setNewCard}
          />
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={props.busyId === "new"}
          >
            {props.busyId === "new" ? "创建中…" : "创建联系名片"}
          </button>
        </form>
      </details>
      <div className={styles.contactList}>
        {props.cards.map((card) => {
          const form = props.cardForms[card.id] ?? formFromCard(card);
          const emergency = props.emergencyForms[card.id] ?? {
            reason: "",
            acknowledged: false,
          };
          return (
            <article key={card.id} className={styles.contactItem}>
              <div className={styles.contactItemHeader}>
                <div>
                  <strong>{card.displayName}</strong>
                  <span>{card.title || "未填写职务"}</span>
                </div>
                <span
                  className={
                    card.status === "active"
                      ? styles.activeBadge
                      : styles.disabledBadge
                  }
                >
                  {card.status === "active" ? "已启用" : "已停用"}
                </span>
              </div>
              <p>
                {[card.phone, card.email, card.wechat]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className={styles.contactActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => props.onToggle(card)}
                  disabled={props.busyId === card.id}
                >
                  {card.status === "active"
                    ? `停用${card.displayName}`
                    : `启用${card.displayName}`}
                </button>
              </div>
              <details className={styles.inlineDetails}>
                <summary>编辑 {card.displayName}</summary>
                <div className={styles.contactForm}>
                  <ContactInputs
                    prefix={card.displayName}
                    value={form}
                    onChange={(next) =>
                      props.setCardForms((current) => ({
                        ...current,
                        [card.id]:
                          typeof next === "function" ? next(form) : next,
                      }))
                    }
                  />
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={() => props.onUpdate(card)}
                    disabled={props.busyId === card.id}
                  >
                    保存{card.displayName}名片
                  </button>
                </div>
              </details>
              <details className={styles.dangerDetails}>
                <summary>紧急移除</summary>
                <div className={styles.dangerBody}>
                  <p>
                    危险操作：从所有仍有效的分享中清除这张名片，已过期或已撤销分享保持不变。
                  </p>
                  <label>
                    <span>紧急移除原因</span>
                    <textarea
                      aria-label="紧急移除原因"
                      value={emergency.reason}
                      onChange={(event) =>
                        props.setEmergencyForms((current) => ({
                          ...current,
                          [card.id]: {
                            ...emergency,
                            reason: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                  <label className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      aria-label="我理解该操作会影响所有有效分享"
                      checked={emergency.acknowledged}
                      onChange={(event) =>
                        props.setEmergencyForms((current) => ({
                          ...current,
                          [card.id]: {
                            ...emergency,
                            acknowledged: event.target.checked,
                          },
                        }))
                      }
                    />
                    <span>我理解该操作会影响所有有效分享</span>
                  </label>
                  <button
                    type="button"
                    className={styles.dangerButton}
                    onClick={() => props.onEmergency(card)}
                    disabled={
                      !emergency.reason.trim() ||
                      !emergency.acknowledged ||
                      props.busyId === card.id
                    }
                  >
                    确认从所有有效分享中紧急移除
                  </button>
                </div>
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ContactInputs({
  prefix,
  value,
  onChange,
}: {
  prefix: string;
  value: ContactForm;
  onChange: React.Dispatch<React.SetStateAction<ContactForm>>;
}) {
  const set = (key: keyof ContactForm, next: string) =>
    onChange((current) => ({ ...current, [key]: next }));
  return (
    <div className={styles.contactFields}>
      <label>
        <span>姓名</span>
        <input
          aria-label={`${prefix}姓名`}
          value={value.displayName}
          onChange={(event) => set("displayName", event.target.value)}
        />
      </label>
      <label>
        <span>职务</span>
        <input
          aria-label={`${prefix}职务`}
          value={value.title}
          onChange={(event) => set("title", event.target.value)}
        />
      </label>
      <label>
        <span>电话</span>
        <input
          aria-label={`${prefix}电话`}
          value={value.phone}
          onChange={(event) => set("phone", event.target.value)}
        />
      </label>
      <label>
        <span>邮箱</span>
        <input
          type="email"
          aria-label={`${prefix}邮箱`}
          value={value.email}
          onChange={(event) => set("email", event.target.value)}
        />
      </label>
      <label>
        <span>微信</span>
        <input
          aria-label={`${prefix}微信`}
          value={value.wechat}
          onChange={(event) => set("wechat", event.target.value)}
        />
      </label>
    </div>
  );
}

function ReadOnlyContacts({ cards }: { cards: OrganizationContactCardDto[] }) {
  if (cards.length === 0) return null;
  return (
    <section
      className={styles.readOnlyContacts}
      aria-labelledby="published-contacts-title"
    >
      <h2 id="published-contacts-title">可公开联系名片</h2>
      <ul>
        {cards.map((card) => (
          <li key={card.id}>
            <strong>{card.displayName}</strong>
            <span>
              {[card.title, card.phone, card.email, card.wechat]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InternalPreview({
  brand,
  logoUrl,
}: {
  brand: PublishedOrganizationBrand;
  logoUrl: string | null;
}) {
  return (
    <section
      className={styles.internalPreview}
      role="region"
      aria-label="内部工作台预览"
      style={
        {
          "--preview-action": brand.actionColor,
          "--preview-soft": brand.softColor,
        } as React.CSSProperties
      }
    >
      <aside>
        <div className={styles.previewBrandRow}>
          <OrganizationBrandMark
            brandName={brand.brandName}
            logoText={brand.logoText}
            logoUrl={logoUrl}
            decorative
            className={styles.previewMark}
          />
          <span>
            <strong>{brand.brandName}</strong>
            <small>{brand.brandTagline}</small>
          </span>
        </div>
        <nav aria-label="模拟工作台导航">
          <span data-active="true">项目作战台</span>
          <span>录屏准入</span>
          <span>结算中心</span>
        </nav>
      </aside>
      <div className={styles.previewWorkArea}>
        <header>
          <strong>今日待处理</strong>
          <span>3 个关键动作</span>
        </header>
        <div className={styles.previewTask}>
          <span>录屏复核</span>
          <strong>检查候选主播资料</strong>
          <button type="button">开始处理</button>
        </div>
        <div className={styles.previewTable}>
          <span>项目</span>
          <span>状态</span>
          <span>负责人</span>
          <strong>星耀新品直播</strong>
          <em>待复核</em>
          <span>运营组</span>
        </div>
      </div>
    </section>
  );
}

function PublicPreview({
  brand,
  logoUrl,
}: {
  brand: PublishedOrganizationBrand;
  logoUrl: string | null;
}) {
  return (
    <section
      className={styles.publicPreview}
      role="region"
      aria-label="公开分享预览"
      style={
        {
          "--preview-action": brand.actionColor,
          "--preview-soft": brand.softColor,
        } as React.CSSProperties
      }
    >
      <header>
        <div className={styles.previewBrandRow}>
          <OrganizationBrandMark
            brandName={brand.brandName}
            logoText={brand.logoText}
            logoUrl={logoUrl}
            decorative
            className={styles.previewMark}
          />
          <span>
            <strong>{brand.brandName}</strong>
            <small>{brand.brandTagline}</small>
          </span>
        </div>
        <span className={styles.publicPurpose}>录屏复核资料</span>
      </header>
      <div className={styles.shareContext}>
        <span>星耀新品直播项目</span>
        <strong>候选主播录屏复核</strong>
        <small>请在有效期内完成逐条复核并提交意见</small>
      </div>
      <div className={styles.shareMedia}>
        <span>品牌封面</span>
        <strong>录屏准备就绪</strong>
        <small>播放后可在右侧记录复核意见</small>
      </div>
      <footer>
        <span>3 条录屏</span>
        <button type="button">开始复核</button>
      </footer>
    </section>
  );
}

function sourceFromPublished(
  brand: PublishedOrganizationBrand,
): OrganizationBrandSource {
  return {
    logoText: brand.logoText,
    logoStoragePath: brand.logoStoragePath,
    brandName: brand.brandName,
    brandTagline: brand.brandTagline,
    primaryColor: brand.primaryColor,
  };
}

function formFromCard(card: OrganizationContactCardDto): ContactForm {
  return {
    displayName: card.displayName,
    title: card.title,
    phone: card.phone ?? "",
    email: card.email ?? "",
    wechat: card.wechat ?? "",
  };
}

function contactPayload(form: ContactForm) {
  return {
    displayName: form.displayName.trim(),
    title: form.title.trim(),
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    wechat: form.wechat.trim() || null,
  };
}

function hasContact(form: ContactForm) {
  return Boolean(form.phone.trim() || form.email.trim() || form.wechat.trim());
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function normalizeBrandLogoErrorCode(value: unknown): BrandLogoClientErrorCode {
  switch (value) {
    case "BRAND_LOGO_INVALID_FILE":
    case "BRAND_LOGO_INVALID_REQUEST":
    case "INVALID_FILE":
      return "BRAND_LOGO_INVALID_FILE";
    case "BRAND_LOGO_TOO_LARGE":
    case "TOO_LARGE":
      return "BRAND_LOGO_TOO_LARGE";
    case "BRAND_LOGO_INVALID_CONTENT":
    case "INVALID_CONTENT":
      return "BRAND_LOGO_INVALID_CONTENT";
    case "BRAND_LOGO_UPLOAD_FAILED":
    case "UPLOAD_FAILED":
      return "BRAND_LOGO_UPLOAD_FAILED";
    case "ORGANIZATION_BRAND_LOGO_UNAVAILABLE":
    case "UNAVAILABLE":
      return "ORGANIZATION_BRAND_LOGO_UNAVAILABLE";
    default:
      return "UNKNOWN";
  }
}

function brandLogoErrorMessage(error: unknown): string {
  const code =
    error instanceof BrandLogoClientError ? error.code : ("UNKNOWN" as const);
  switch (code) {
    case "BRAND_LOGO_INVALID_FILE":
      return "仅支持 JPEG、PNG 或 WebP 图片。";
    case "BRAND_LOGO_TOO_LARGE":
      return "LOGO 图片不能超过 2 MB。";
    case "BRAND_LOGO_INVALID_CONTENT":
      return "图片内容无效或像素尺寸过大，请更换图片。";
    case "BRAND_LOGO_PREPARATION_UNAVAILABLE":
      return "当前浏览器无法安全处理 LOGO，请更换浏览器或图片。";
    case "BRAND_LOGO_UPLOAD_FAILED":
    case "ORGANIZATION_BRAND_LOGO_UNAVAILABLE":
      return "LOGO 服务暂时不可用，请稍后重试。";
    default:
      return "LOGO 上传失败，请重试。";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function displayDifference(
  value: OrganizationBrandSource[keyof OrganizationBrandSource],
) {
  if (value === null || value === "") return "未设置";
  if (typeof value === "string" && value.includes("/brand-logos/"))
    return "已上传图片";
  return value;
}

function formatPublishedAt(value: string | null) {
  return value ? `发布于 ${formatDate(value)}` : "尚无发布时间";
}

function formatDate(value: string | null) {
  if (!value) return "尚未发布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

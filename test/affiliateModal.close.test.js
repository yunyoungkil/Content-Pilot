import { renderAffiliateModal } from "../js/ui/affiliateModal.js";

// 모듈 내부에서 사용하는 서비스들 모킹하여 loadLinks가 안전하게 동작하게 함
jest.mock("../js/services/affiliateService.js", () => ({
  getAffiliateLinks: jest.fn().mockResolvedValue([]),
  addAffiliateLink: jest.fn().mockResolvedValue({}),
  updateAffiliateLink: jest.fn().mockResolvedValue({}),
  deleteAffiliateLink: jest.fn().mockResolvedValue({}),
}));

describe("affiliateModal close behavior", () => {
  test("clicking header close button hides modal", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    // 렌더링 (bindEvents 포함)
    renderAffiliateModal(container);

    // modal은 기본적으로 display:none 이므로 열어둔다
    const modal = container.querySelector("#affiliate-modal");
    expect(modal).toBeTruthy();
    modal.style.display = "block";

    const closeBtn = container.querySelector(
      ".cp-modal-close, .affiliate-close-btn"
    );
    expect(closeBtn).toBeTruthy();

    // 클릭 시 닫혀야 함
    closeBtn.click();
    expect(modal.style.display).toBe("none");
  });

  test("clicking backdrop hides modal and form", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    renderAffiliateModal(container);

    const modal = container.querySelector("#affiliate-modal");
    const form = container.querySelector("#affiliate-form-container");
    expect(modal).toBeTruthy();
    if (form) form.style.display = "block";

    modal.style.display = "block";
    const backdrop = container.querySelector(".cp-modal-backdrop");
    expect(backdrop).toBeTruthy();

    backdrop.click();

    expect(modal.style.display).toBe("none");
    if (form)
      expect(
        form.style.display === "none" || form.style.display === ""
      ).toBeTruthy();
  });
});

import { getCurrentPage } from "../common/utils";

const onPageScroll = function onPageScroll(event) {
  const page = getCurrentPage();
  if (!page) {
    return;
  }
  const { pageScroller } = page;
  pageScroller?.forEach((scroller) => {
    if (typeof scroller === "function") {
      scroller(event);
    }
  });
};

export default (method = "onScroll") =>
  Behavior({
    attached() {
      const page = getCurrentPage();
      if (!page) {
        return;
      }
      const scroller = this[method]?.bind(this);
      if (scroller) {
        this._pageScroller = scroller;
      }
      if (Array.isArray(page.pageScroller)) {
        page.pageScroller.push(scroller);
      } else {
        page.pageScroller =
          typeof page.onPageScroll === "function" ? [page.onPageScroll.bind(page), scroller] : [scroller];
      }
      page.onPageScroll = onPageScroll;
    },
    detached() {
      const page = getCurrentPage();
      if (page) {
        page.pageScroller = page.pageScroller?.filter((scroller) => scroller !== this._pageScroller) || [];
      }
    }
  });

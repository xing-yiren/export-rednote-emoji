/** 依据 P0 实测结构手工构造的评论区 DOM（不含真实用户数据）。 */
export const COMMENT_PAGE_HTML = `
<div id="app">
  <div id="noteContainer" class="note-container">
    <div class="author">
      <div class="author-wrapper"><div class="info">
        <div class="avatar-click"><div class="avatar-container"><a href="/user/profile/noteauthor"><img class="avatar-item" src="https://sns-avatar-qc.xhscdn.com/avatar/noteauthor.jpg"></a></div></div>
        <a class="name" href="/user/profile/noteauthor">笔记作者</a>
      </div></div>
    </div>
    <div class="media-container">
      <img id="note-main-image" src="https://sns-webpic-qc.xhscdn.com/202601010000/hash1/notes_pre_post/noteimg!nd_dft_wgth_webp_3">
    </div>
    <div class="interaction-container">
      <div class="note-scroller">
        <div class="note-content"><h1 id="detail-title" class="title">标题</h1></div>
        <div id="comment-root">
          <div class="parent-comment">
            <div id="comment-cmtA" class="comment-item">
              <div class="comment-inner-container">
                <div class="avatar">
                  <a href="/user/profile/alice?xsec_token=x"><img class="avatar-item" data-user-id="alice-id" src="https://sns-avatar-qc.xhscdn.com/avatar/alice.jpg"></a>
                </div>
                <div class="right">
                  <div class="author"><span class="name">Alice</span></div>
                  <div class="comment-picture"><div class="img-box"><img class="inner" src="https://sns-webpic-qc.xhscdn.com/202601010000/hashA/comment/imgA!nc_n_webp_mw_1"></div></div>
                  <div class="comment-picture"><div class="img-box"><img class="inner" src="http://sns-webpic-qc.xhscdn.com/202601010000/hashB/comment/imgB!nc_n_webp_mw_1"></div></div>
                </div>
              </div>
            </div>
          </div>
          <div class="parent-comment">
            <div id="comment-cmtB" class="comment-item">
              <div class="comment-inner-container">
                <div class="avatar">
                  <a href="/user/profile/bob?xsec_token=y"><img class="avatar-item" data-user-id="bob-id" src="https://sns-avatar-qc.xhscdn.com/avatar/bob.jpg"></a>
                </div>
                <div class="right">
                  <div class="author"><span class="name">Bob</span></div>
                  <div class="comment-picture"><div class="img-box"><img class="inner" src="https://sns-webpic-qc.xhscdn.com/202601010000/hashA/comment/imgA!nc_n_webp_mw_1"></div></div>
                  <div class="comment-picture"><div class="img-box"><img class="inner" src="https://evil.example.com/x.png"></div></div>
                  <div class="comment-picture"><div class="img-box"><img class="inner" src="data:image/png;base64,AAAA"></div></div>
                </div>
              </div>
            </div>
          </div>
          <div class="comment-item">
            <div class="comment-inner-container">
              <div class="avatar"><img class="avatar-item" data-user-id="noctext-id" src="https://sns-avatar-qc.xhscdn.com/avatar/x.jpg"></div>
              <div class="right"><div class="comment-picture"><div class="img-box"><img class="inner" alt="未加载" data-src="https://sns-webpic-qc.xhscdn.com/202601010000/hashC/comment/imgC!nc_n_webp_mw_1"></div></div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<div id="outer-feed">
  <div class="comment-item" id="comment-outside">
    <div class="comment-inner-container">
      <div class="avatar"><img class="avatar-item" data-user-id="outside-id" src="https://sns-avatar-qc.xhscdn.com/avatar/o.jpg"></div>
      <div class="right"><div class="comment-picture"><div class="img-box"><img class="inner" src="https://sns-webpic-qc.xhscdn.com/202601010000/hashZ/comment/outside!nc_n_webp_mw_1"></div></div></div>
    </div>
  </div>
</div>`;
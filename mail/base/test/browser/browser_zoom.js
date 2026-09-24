/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

const { MessageGenerator } = ChromeUtils.importESModule(
  "resource://testing-common/mailnews/MessageGenerator.sys.mjs"
);
const { ensure_cards_view, prepare_thread_row_descendant_click } =
  ChromeUtils.importESModule(
    "resource://testing-common/MailViewHelpers.sys.mjs"
  );

const tabmail = document.getElementById("tabmail");
const about3Pane = tabmail.currentAbout3Pane;
const { threadTree } = about3Pane;
let testFolder;

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [["mailnews.scroll_to_new_message", false]],
  });
  // Create an account for the test.
  const account = MailServices.accounts.createLocalMailAccount();
  account.addIdentity(MailServices.accounts.createIdentity());

  // Create a folder for the account to store test messages.
  const rootFolder = account.incomingServer.rootFolder.QueryInterface(
    Ci.nsIMsgLocalMailFolder
  );
  testFolder = rootFolder
    .createLocalSubfolder("zoom")
    .QueryInterface(Ci.nsIMsgLocalMailFolder);

  // Generate test messages.
  const generator = new MessageGenerator();
  testFolder.addMessageBatch(
    generator
      .makeMessages({ count: 5, msgsPerThread: 5 })
      .map(message => message.toMessageString())
  );

  // Use the test folder.
  about3Pane.displayFolder(testFolder.URI);
  await ensure_cards_view(document);

  // Remove test account on cleanup.
  registerCleanupFunction(() => {
    MailServices.accounts.removeAccount(account, false);
  });
});

/**
 * Tests zooming in and out of the multi-message view using keyboard shortcuts
 * when viewing a thread.
 */
add_task(async function testMultiMessageZoom() {
  // Threads need to be collapsed, otherwise the multi-message view
  // won't be shown.
  const row = threadTree.getRowAtIndex(0);
  await BrowserTestUtils.waitForMutationCondition(
    row,
    {
      attributes: true,
      attributeFilter: ["class"],
    },
    () => row.classList.contains("collapsed")
  );

  const subjectLine = row.querySelector(
    ".thread-card-subject-container .subject"
  );
  // Simulate a click on the row's subject line to select the row.
  const selectPromise = BrowserTestUtils.waitForEvent(threadTree, "select");
  await prepare_thread_row_descendant_click(row, AccessibilityUtils);
  EventUtils.synthesizeMouseAtCenter(
    subjectLine,
    { clickCount: 1 },
    about3Pane
  );
  AccessibilityUtils.resetEnv();
  await selectPromise;
  // Make sure the correct thread is selected and that the multi-message view is
  // visible.
  Assert.ok(
    row.classList.contains("selected"),
    "The thread row should be selected"
  );
  Assert.ok(
    BrowserTestUtils.isVisible(about3Pane.multiMessageBrowser),
    "The multi-message browser should be visible"
  );

  // Record the zoom value before the operation.
  let previousZoom = top.ZoomManager.getZoomForBrowser(
    about3Pane.multiMessageBrowser
  );

  // Emulate a zoom in.
  EventUtils.synthesizeKey("+", { accelKey: true });

  // Test that the zoom value increases.
  await TestUtils.waitForCondition(
    () =>
      top.ZoomManager.getZoomForBrowser(about3Pane.multiMessageBrowser) >
      previousZoom,
    "zoom value should be greater than before keyboard event"
  );

  // Emulate a zoom out.
  previousZoom = top.ZoomManager.getZoomForBrowser(
    about3Pane.multiMessageBrowser
  );
  EventUtils.synthesizeKey("-", { accelKey: true });

  // Test that the zoom value decreases.
  await TestUtils.waitForCondition(
    () =>
      previousZoom >
      top.ZoomManager.getZoomForBrowser(about3Pane.multiMessageBrowser),
    "zoom value should be less than before keyboard event"
  );
});

/**
 * Tests that toggling between full zoom and text zoom keeps the zoom level.
 */
add_task(async function testToggleZoom() {
  await SpecialPowers.pushPrefEnv({ set: [["browser.zoom.full", true]] });
  const browser = about3Pane.multiMessageBrowser;
  top.ZoomManager.setZoomForBrowser(browser, 1.5);

  top.ZoomManager.toggleZoom(browser);
  Assert.ok(!top.ZoomManager.useFullZoom, "text zoom should be in use");
  Assert.equal(browser.textZoom, 1.5, "text zoom should keep the zoom level");
  Assert.equal(browser.fullZoom, 1, "full zoom should be reset");

  top.ZoomManager.toggleZoom(browser);
  Assert.ok(top.ZoomManager.useFullZoom, "full zoom should be in use");
  Assert.equal(browser.fullZoom, 1.5, "full zoom should keep the zoom level");
  Assert.equal(browser.textZoom, 1, "text zoom should be reset");

  top.ZoomManager.reset(browser);
  await SpecialPowers.popPrefEnv();
});

/**
 * Tests that mail.message.zoom_percent sets the starting zoom of the 3-pane
 * message pane, a message tab and a compose window, that the message tab
 * keeps it when another message is displayed, and that the message pane
 * follows changes to the pref.
 */
add_task(async function testDefaultMessageZoom() {
  await SpecialPowers.pushPrefEnv({
    set: [["mail.message.zoom_percent", 150]],
  });
  const messages = [...testFolder.messages];

  const threePaneTab = tabmail.openTab("mail3PaneTab", {
    folderURI: testFolder.URI,
    background: false,
  });
  await BrowserTestUtils.browserLoaded(threePaneTab.chromeBrowser);
  const newAbout3Pane = threePaneTab.chromeBrowser.contentWindow;
  await newAbout3Pane.hasDOMContentLoaded.promise;
  const previewAboutMessage = newAbout3Pane.messageBrowser.contentWindow;
  const previewPane = previewAboutMessage.getMessagePaneBrowser();
  const previewLoaded = BrowserTestUtils.waitForEvent(
    previewAboutMessage,
    "MsgLoaded"
  );
  newAbout3Pane.messagePane.displayMessage(
    messages[0].folder.getUriForMsg(messages[0])
  );
  await previewLoaded;
  Assert.equal(
    top.ZoomManager.getZoomForBrowser(previewPane),
    1.5,
    "3-pane message pane should start at the zoom level from the pref"
  );

  await SpecialPowers.pushPrefEnv({
    set: [["mail.message.zoom_percent", 200]],
  });
  Assert.equal(
    top.ZoomManager.getZoomForBrowser(previewPane),
    2,
    "3-pane message pane should follow a change to the pref"
  );
  await SpecialPowers.popPrefEnv();
  Assert.equal(
    top.ZoomManager.getZoomForBrowser(previewPane),
    1.5,
    "3-pane message pane should follow the pref being restored"
  );
  tabmail.closeTab(threePaneTab);

  const tab = window.OpenMessageInNewTab(messages[0], { background: false });
  await BrowserTestUtils.waitForEvent(tab.chromeBrowser, "MsgLoaded");
  const aboutMessage = tab.chromeBrowser.contentWindow;
  const messagePane = aboutMessage.getMessagePaneBrowser();
  Assert.equal(
    top.ZoomManager.getZoomForBrowser(messagePane),
    1.5,
    "message tab should start at the zoom level from the pref"
  );

  const loadedPromise = BrowserTestUtils.waitForEvent(
    tab.chromeBrowser,
    "MsgLoaded"
  );
  aboutMessage.displayMessage(messages[1].folder.getUriForMsg(messages[1]));
  await loadedPromise;
  Assert.equal(
    top.ZoomManager.getZoomForBrowser(messagePane),
    1.5,
    "zoom level should survive displaying another message"
  );
  tabmail.closeTab(tab);

  const composePromise = BrowserTestUtils.domWindowOpenedAndLoaded(
    null,
    win =>
      win.document.documentURI ==
      "chrome://messenger/content/messengercompose/messengercompose.xhtml"
  );
  EventUtils.synthesizeKey("n", { accelKey: true });
  const composeWindow = await composePromise;
  await TestUtils.waitForCondition(
    () => composeWindow.composeEditorReady,
    "waiting for the compose editor to be ready"
  );
  Assert.equal(
    composeWindow.ZoomManager.getZoomForBrowser(composeWindow.getBrowser()),
    1.5,
    "compose window should start at the zoom level from the pref"
  );
  await BrowserTestUtils.closeWindow(composeWindow);

  await SpecialPowers.popPrefEnv();
});

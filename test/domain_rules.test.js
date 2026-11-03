/**
 * 領域邏輯單元測試套件
 */
import {
    sortBySeat,
    isPulledOut,
    isRecordPulledOut,
    pulloutLabel,
    nextPullout,
    isExamAssignment,
    pointsOf,
    isSchoolDay,
    formatPointLogItems,
    escapeHtml,
    nextStatus,
    nextSign,
    sortArchivedAssignments,
    resolveLostAssignments,
    getLatestEligibleAssignmentDate,
    isGradingMissingExempt,
    deriveRecordStatus,
    deriveRecordSign,
    appendMakeupSubmitRemark,
    removeMakeupSubmitRemark,
    appendMakeupSignRemark,
    removeMakeupSignRemark,
    toggleLeaveRemark,
    isRecordLeave,
    isRecordMakeup,
    deriveRecordRemark,
    sanitizeArchiveRecords,
    resolveAssignmentISODate,
    computeGlobalPopupLists,
    computeMakeupAndLeaveStats,
    formatMakeupAndLeaveReport
} from '../src/domain/rules.js';

export function runAllDomainTests(assert) {
    // 1. 座號排序測試
    {
        const students = [
            { name: '王大明', seat: '15' },
            { name: '李小華', seat: '2' },
            { name: '陳無號', seat: '' },
            { name: '張同號A', seat: '5' },
            { name: '白同號B', seat: '5' },
            { name: '林無號2', seat: null }
        ];
        const sorted = sortBySeat(students);
        assert.strictEqual(sorted[0].name, '李小華', '最小座號應排在最前');
        assert.strictEqual(sorted[1].name, '白同號B', '相同座號應依姓名繁體拼音排序');
        assert.strictEqual(sorted[2].name, '張同號A');
        assert.strictEqual(sorted[3].name, '王大明');
        assert.strictEqual(sorted[4].seat, '', '無座號應排在最後');
        assert.strictEqual(sorted[5].seat, null);
    }

    // 2. 抽離學生判定
    {
        const s1 = { name: '學生A', pullout: { chinese: true, math: false } };
        const s2 = { name: '學生B', pullout: { chinese: false, math: true } };
        const s3 = { name: '學生C', pullout: null };

        assert.strictEqual(isPulledOut(s1, '國語'), true, '國語抽離應為 true');
        assert.strictEqual(isPulledOut(s1, '數學'), false, '未抽離數學應為 false');
        assert.strictEqual(isPulledOut(s2, '數學'), true, '數學抽離應為 true');
        assert.strictEqual(isPulledOut(s3, '國語'), false, '無抽離設定應為 false');
        assert.strictEqual(pulloutLabel(s1.pullout), '抽離:國');
        assert.strictEqual(pulloutLabel({ chinese: true, math: true }), '抽離:國數');
        
        // 抽離判斷支援作業名稱（國/數關鍵字自動識別）
        assert.strictEqual(isPulledOut(s1, '', '國語習作'), true, '科目為空但作業名稱包含國語應判定抽離');
        assert.strictEqual(isPulledOut(s1, '未分類', '2026/09/25 國習 p.10'), true, '科目未分類但作業含國習應判定抽離');
        assert.strictEqual(isPulledOut(s2, '', '數學習作第5頁'), true, '科目為空但作業包含數學習作應判定抽離');
        assert.strictEqual(isPulledOut(s1, '', '英文作業'), false, '非國數作業不應判定抽離');

        // 綜合紀錄抽離判斷 (isRecordPulledOut)
        assert.strictEqual(isRecordPulledOut({ pulledOut: true }, s3, '自然'), true, '快照已記錄抽離直接判定為 true');
        assert.strictEqual(isRecordPulledOut({ pulledOut: false, assignmentName: '國語考卷' }, s1, ''), true, '快照為 false 但學生設定抽離國語應回退為 true');
        assert.strictEqual(isRecordPulledOut(null, s2, '數學'), true, '無紀錄但學生抽離數學應為 true');
        assert.strictEqual(isRecordPulledOut(null, s1, '自然', '昆蟲觀察表'), false, '非抽離科目應為 false');
        
        let p = nextPullout(null);
        assert.deepStrictEqual(p, { chinese: true, math: false });
        p = nextPullout(p);
        assert.deepStrictEqual(p, { chinese: false, math: true });
        p = nextPullout(p);
        assert.deepStrictEqual(p, { chinese: true, math: true });
        p = nextPullout(p);
        assert.deepStrictEqual(p, { chinese: false, math: false });
    }

    // 3. 考試型作業判定
    {
        assert.strictEqual(isExamAssignment('國語隨堂考'), true);
        assert.strictEqual(isExamAssignment('第一單元測驗卷'), true);
        assert.strictEqual(isExamAssignment('英文聽力'), true);
        assert.strictEqual(isExamAssignment('數學習作 P.10-12'), false);
    }

    // 4. 計分規則 (pointsOf)
    {
        const settings = {
            assignments: [
                { id: 'a1', name: '數學習作', signOnly: false },
                { id: 'a2', name: '家長簽名表', signOnly: true },
                { id: 'a3', name: '第一單元複習卷', signOnly: false }
            ]
        };

        // 一般作業全對 10 點
        assert.strictEqual(pointsOf({ assignmentId: 'a1', assignmentName: '數學習作', correctness: '全對' }, settings), 10);
        // 有錯且訂正 5 點
        assert.strictEqual(pointsOf({ assignmentId: 'a1', assignmentName: '數學習作', correctness: '有錯', corrected: true }, settings), 5);
        // 有錯但未訂正 0 點
        assert.strictEqual(pointsOf({ assignmentId: 'a1', assignmentName: '數學習作', correctness: '有錯', corrected: false }, settings), 0);
        // 遺失 0 點
        assert.strictEqual(pointsOf({ assignmentId: 'a1', assignmentName: '數學習作', correctness: '遺失' }, settings), 0);
        
        // 只要簽名的作業不給點
        assert.strictEqual(pointsOf({ assignmentId: 'a2', assignmentName: '家長簽名表', correctness: '全對' }, settings), 0);
        
        // 考試/測驗作業不給點
        assert.strictEqual(pointsOf({ assignmentId: 'a3', assignmentName: '第一單元複習卷', correctness: '全對' }, settings), 0);
        
        // 聯絡簿每日任務不在此加點
        assert.strictEqual(pointsOf({ assignmentId: 'daily', assignmentName: '聯絡簿每日任務', correctness: '全對' }, settings), 0);

        // 關鍵修復驗證：封存後（作業已不在 settings.assignments），配合 fallbackMeta 依然維持 signOnly 不給點！
        const archivedRecord = { assignmentId: 'a_archived', assignmentName: '已封存簽名單', correctness: '全對' };
        assert.strictEqual(pointsOf(archivedRecord, { assignments: [] }, { signOnly: true }), 0, '已封存的 signOnly 作業不應誤發點數');
    }

    // 5. 上課日判斷 (isSchoolDay)
    {
        const sem = {
            startDate: '2026-09-01',
            endDate: '2027-01-20',
            skipWeekends: true,
            holidays: ['2026-09-17', '2026-10-10']
        };

        // 2026-09-16 為週三 (在學期內，非假日)
        assert.strictEqual(isSchoolDay('2026-09-16', sem), true, '週三平日應為上課日');
        // 2026-09-17 設為自訂假
        assert.strictEqual(isSchoolDay('2026-09-17', sem), false, '自訂假日應不上課');
        // 2026-09-20 為週日
        assert.strictEqual(isSchoolDay('2026-09-20', sem), false, '週日應不上課');
        // 學期前
        assert.strictEqual(isSchoolDay('2026-08-30', sem), false, '開學前應不上課');
        // 學期後
        assert.strictEqual(isSchoolDay('2027-02-01', sem), false, '結業後應不上課');
    }

    // 6. 加點匯出字串格式化（修復 [object Object] Bug）
    {
        const rawItems = [
            { assignmentId: '1', assignmentName: '國語習作', type: '全對', points: 10 },
            { assignmentId: '2', assignmentName: '數學習作', type: '訂正完成', points: 5 }
        ];
        const formatted = formatPointLogItems(rawItems);
        assert.strictEqual(formatted, '國語習作(全對) +10點、數學習作(訂正完成) +5點', '加點明細不可含有 [object Object]');
    }

    // 7. 狀態輪替與安全轉義
    {
        assert.strictEqual(nextStatus('未繳'), '已繳');
        assert.strictEqual(nextStatus('已繳'), '未繳');
        assert.strictEqual(nextSign('未簽名'), '已簽名');
        assert.strictEqual(nextSign('已簽名'), '未簽名');
        assert.strictEqual(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    }

    // 8. 歷史作業日期降冪排序（越新越前面）
    {
        const entries = [
            ['a1', { name: '數習 p.10', dateLabel: '2026/09/14' }],
            ['a2', { name: '數習 p.16～17', dateLabel: '2026/09/16' }],
            ['a3', { name: '數習 p.12～13', dateLabel: '2026/09/15' }]
        ];
        const sorted = sortArchivedAssignments(entries);
        assert.strictEqual(sorted[0][0], 'a2', '最新日期 09/16 應排在第 1 個');
        assert.strictEqual(sorted[1][0], 'a3', '次新日期 09/15 應排在第 2 個');
        assert.strictEqual(sorted[2][0], 'a1', '較舊日期 09/14 應排在第 3 個');
    }

    // 9. 遺失作業即時更新（活資料覆蓋封存資料）
    {
        const students = [{ id: 's1', name: '學生甲' }, { id: 's2', name: '學生乙' }];
        const archives = {
            arch1: {
                records: [{ studentId: 's1', assignmentId: 'a1', assignmentName: '數習', correctness: '遺失' }]
            }
        };
        const initial = resolveLostAssignments(students, [], archives);
        assert.strictEqual(initial.length, 1, '初始應有 1 位遺失作業');
        assert.strictEqual(initial[0].id, 's1', '遺失者為學生甲');

        // 老師取消遺失（live grading 寫入空字串）
        const live = [{ studentId: 's1', assignmentId: 'a1', assignmentName: '數習', correctness: '' }];
        const after = resolveLostAssignments(students, live, archives);
        assert.strictEqual(after.length, 0, '移除遺失後應即時清空，不再顯示為遺失作業');
    }

    // 10. 加點最新作業日期提取
    {
        const eligible = [{ assignmentId: 'a1' }, { assignmentId: 'a2' }];
        const archMap = {
            a1: { dateLabel: '2026/09/14' },
            a2: { dateLabel: '2026/09/16' }
        };
        const latest = getLatestEligibleAssignmentDate(eligible, {}, archMap, {});
        assert.strictEqual(latest, '9月16日', '應提取到最新日期 9月16日');
    }

    // 11. 未繳作業缺交顯示與豁免判斷 (聽考、複A卷、複B卷)
    {
        assert.strictEqual(isGradingMissingExempt('國語聽考'), true, '國語聽考應豁免缺交限制');
        assert.strictEqual(isGradingMissingExempt('數學複A卷'), true, '數學複A卷應豁免缺交限制');
        assert.strictEqual(isGradingMissingExempt('複b卷'), true, '複b卷小寫應豁免缺交限制');
        assert.strictEqual(isGradingMissingExempt('數學習作'), false, '數學習作不應豁免');
        assert.strictEqual(isGradingMissingExempt('2026/09/14 L3預習單'), false, '預習單不應豁免');
    }

    // 12. 狀態與簽名解析安全防護及封存資料清理
    {
        // 活紀錄有 status 優先
        assert.strictEqual(deriveRecordStatus({ status: '已繳' }, { status: '未繳' }), '已繳');
        // 活紀錄 status 為空/undefined，回退至封存紀錄
        assert.strictEqual(deriveRecordStatus({ signStatus: '已簽名' }, { status: '已繳' }), '已繳', '活紀錄缺少 status 時應回退至封存紀錄 status');
        // 封存紀錄已補交，活紀錄即使殘留「未繳」亦判定為「已繳」
        assert.strictEqual(deriveRecordStatus({ status: '未繳' }, { status: '已繳' }), '已繳', '封存紀錄已補交時不應被未繳覆蓋');
        assert.strictEqual(deriveRecordStatus({ status: '未繳' }, '已繳'), '已繳', '支援字串 fallback 解析已繳');
        // 兩者皆無時預設為「未繳」
        assert.strictEqual(deriveRecordStatus(null, null), '未繳');
        assert.strictEqual(deriveRecordStatus({}, {}), '未繳');

        // 簽名狀態同理
        assert.strictEqual(deriveRecordSign({ signStatus: '已簽名' }, { signStatus: '未簽名' }), '已簽名');
        assert.strictEqual(deriveRecordSign({ status: '已繳' }, { signStatus: '已簽名' }), '已簽名', '活紀錄缺少 signStatus 時應回退至封存紀錄 signStatus');
        assert.strictEqual(deriveRecordSign({ signStatus: '未簽名' }, { signStatus: '已簽名' }), '已簽名', '封存紀錄已補簽時不應被未簽覆蓋');
        assert.strictEqual(deriveRecordSign({ signStatus: '未簽名' }, '已簽名'), '已簽名', '支援字串 fallback 解析已簽');
        assert.strictEqual(deriveRecordSign(null, null), '未簽名');

        // 封存紀錄清理測試（確保無 undefined 欄位且保留 pulledOut 避免 Firestore setDoc 報錯或丟失抽離狀態）
        const sanitized = sanitizeArchiveRecords([
            { studentId: 's1', status: undefined, signStatus: undefined, correctness: undefined, corrected: undefined, pulledOut: true }
        ]);
        assert.strictEqual(sanitized[0].status, '未繳');
        assert.strictEqual(sanitized[0].signStatus, '未簽名');
        assert.strictEqual(sanitized[0].correctness, '');
        assert.strictEqual(sanitized[0].corrected, false);
        assert.strictEqual(sanitized[0].pulledOut, true, '應正確保留 pulledOut 狀態');
        assert.strictEqual(Object.values(sanitized[0]).includes(undefined), false, '不得包含 undefined 欄位');
    }

    // 13. 全域統計清單（未繳、未訂正、未簽名）包含歷史聯絡簿與封存作業邏輯驗證
    {
        const testStudents = [
            { id: 's1', name: '學生甲', seat: '1', pullout: null },
            { id: 's2', name: '學生乙', seat: '2', pullout: null },
            { id: 's3', name: '學生丙', seat: '3', pullout: { chinese: true, math: false } },
            { id: 's4', name: '學生丁', seat: '4', pullout: null },
            { id: 's5', name: '學生戊', seat: '5', pullout: null }
        ];
        const pastContactId = 'daily-聯絡簿每日任務-2026-11-03-test';
        const testExtraPast = {
            [pastContactId]: {
                name: '聯絡簿每日任務',
                dateLabel: '2026/11/03',
                subjectName: '聯絡簿',
                needsSign: true,
                signOnly: false
            }
        };
        const testArchiveDoc = {
            id: 'arc_1103',
            dateLabel: '2026/11/03',
            assignments: [{ id: pastContactId, name: '聯絡簿每日任務', subjectName: '聯絡簿', needsSign: true }],
            records: [
                { studentId: 's1', assignmentId: pastContactId, status: '已繳', signStatus: '未簽名', correctness: '有錯', corrected: false },
                { studentId: 's2', assignmentId: pastContactId, status: '未繳', signStatus: '未簽名', correctness: '', corrected: false },
                { studentId: 's3', assignmentId: pastContactId, status: '未繳', signStatus: '未簽名', correctness: '', corrected: false, pulledOut: true },
                { studentId: 's4', assignmentId: pastContactId, status: '已繳', signStatus: '已簽名', correctness: '全對', corrected: false },
                { studentId: 's5', assignmentId: pastContactId, status: '已繳', signStatus: '已簽名', correctness: '沒寫任務', corrected: false }
            ]
        };
        const testArchiveDocsMap = {
            [pastContactId]: testArchiveDoc,
            'arc_1103': testArchiveDoc
        };

        // 驗證未訂正判斷：學生甲有錯未訂正
        const archRec1 = testArchiveDoc.records.find(r => r.studentId === 's1');
        const correctness1 = archRec1.correctness;
        const isCorrected1 = !!archRec1.corrected;
        assert.strictEqual(correctness1 === '有錯' && !isCorrected1, true, '學生甲應列入未訂正');

        // 驗證未簽名判斷：學生甲已繳未簽
        const status1 = deriveRecordStatus(null, archRec1.status);
        const signStatus1 = deriveRecordSign(null, archRec1.signStatus);
        assert.strictEqual(status1 === '已繳' && signStatus1 !== '已簽名', true, '學生甲應列入未簽名');

        // 驗證未繳判斷：學生乙未繳，學生丙抽離，學生戊沒寫任務
        const archRec2 = testArchiveDoc.records.find(r => r.studentId === 's2');
        const status2 = deriveRecordStatus(null, archRec2.status);
        assert.strictEqual(status2 !== '已繳', true, '學生乙應列入未繳');

        const archRec3 = testArchiveDoc.records.find(r => r.studentId === 's3');
        assert.strictEqual(archRec3.pulledOut, true, '學生丙抽離應被排除');

        const archRec5 = testArchiveDoc.records.find(r => r.studentId === 's5');
        assert.strictEqual(archRec5.correctness === '沒寫任務', true, '學生戊沒寫任務應被豁免排除於未繳');

        // 完整驗證 computeGlobalPopupLists（即使多個聯絡簿封存、同 ID 碰撞亦全部正確列出）
        const activeContactId = 'daily-聯絡簿每日任務-2026-11-04';
        const olderArchiveDoc = {
            id: 'arc_1102',
            timestamp: 1762070400000,
            dateLabel: '2026/11/02',
            assignments: [{ id: activeContactId, name: '聯絡簿每日任務', subjectName: '聯絡簿', needsSign: true }],
            records: [
                { studentId: 's4', assignmentId: activeContactId, status: '未繳', signStatus: '未簽名', correctness: '', corrected: false }
            ]
        };
        const popupLists = computeGlobalPopupLists({
            settings: {
                students: testStudents,
                subjects: [{ id: 'subj_c', name: '聯絡簿' }],
                assignments: [{ id: activeContactId, name: '聯絡簿每日任務', subjectId: 'subj_c', needsSign: true }]
            },
            records: [{ studentId: 's4', assignmentId: activeContactId, status: '已繳', signStatus: '已簽名' }], // 今日已繳不應覆蓋 11/02 同 ID 封存快照
            gradingRecords: [],
            archiveDocsList: [
                { ...testArchiveDoc, timestamp: 1762156800000 },
                olderArchiveDoc
            ],
            archiveDocsMap: testArchiveDocsMap,
            extraPastAssignments: testExtraPast
        });
        assert.strictEqual(popupLists.missingBlocks.length, 2, '兩個日期的聯絡簿封存未繳皆應完整呈現');
        assert.strictEqual(popupLists.missingBlocks[0].displayName, '2026/11/03 聯絡簿每日任務');
        assert.deepStrictEqual(popupLists.missingBlocks[0].studentNames, ['學生乙']);
        assert.strictEqual(popupLists.missingBlocks[1].displayName, '2026/11/02 聯絡簿每日任務');
        assert.deepStrictEqual(popupLists.missingBlocks[1].studentNames, ['學生丁']);
        assert.strictEqual(popupLists.uncorrectedBlocks.length, 1);
        assert.deepStrictEqual(popupLists.uncorrectedBlocks[0].studentNames, ['學生甲']);
        assert.strictEqual(popupLists.unsignedBlocks.length, 1);
        assert.deepStrictEqual(popupLists.unsignedBlocks[0].studentNames, ['學生甲']);
    }

    // 14. 補繳／補簽／請假備註同步與標準化驗證
    {
        let rmk = '';
        rmk = appendMakeupSubmitRemark(rmk, '2026/11/03 16:00:00');
        assert.strictEqual(rmk, '已補繳（2026/11/03 16:00:00）', '補繳應寫入已補繳文字');
        rmk = appendMakeupSignRemark(rmk, '2026/11/03 16:05:00');
        assert.strictEqual(rmk, '已補繳（2026/11/03 16:00:00） / 已補簽（2026/11/03 16:05:00）', '補簽應保留既有已補繳文字');
        rmk = toggleLeaveRemark(rmk, true);
        assert.strictEqual(rmk, '請假 / 已補繳（2026/11/03 16:00:00） / 已補簽（2026/11/03 16:05:00）', '標記請假應保留補繳與補簽紀錄');
        rmk = removeMakeupSignRemark(rmk);
        assert.strictEqual(rmk, '請假 / 已補繳（2026/11/03 16:00:00）', '取消補簽僅移除補簽段落');
        rmk = removeMakeupSubmitRemark(rmk);
        assert.strictEqual(rmk, '請假', '改回未繳仍保留請假標記');

        // 舊格式「已補交 / 補簽」自動標準化為「已補繳 / 已補簽」
        const derived = deriveRecordRemark(
            { status: '已繳', signStatus: '已簽名', remark: '補簽（11/03）' },
            { status: '已繳', signStatus: '未簽名', remark: '已補交（11/02）', isLeave: true }
        );
        assert.strictEqual(derived, '請假 / 已補繳（11/02） / 已補簽（11/03）');
    }

    // 15. 期中／期末補繳與請假（另外算）統計驗證
    {
        const students = [
            { id: 's1', name: '王小明', seat: '1' },
            { id: 's2', name: '李小華', seat: '2' },
            { id: 's3', name: '張全勤', seat: '3' }
        ];
        const archSep = {
            id: 'arc_0925',
            timestamp: new Date('2026-09-25T16:00:00').getTime(),
            dateLabel: '9/25',
            assignments: [{ id: 'hw_sep', name: '數習 P.10', subjectName: '數學' }],
            records: [
                { studentId: 's1', assignmentId: 'hw_sep', assignmentName: '數習 P.10', status: '已繳', remark: '已補繳（9/26）', isMakeup: true, isLeave: false },
                { studentId: 's2', assignmentId: 'hw_sep', assignmentName: '數習 P.10', status: '已繳', remark: '請假 / 已補繳（9/26）', isMakeup: true, isLeave: true },
                { studentId: 's3', assignmentId: 'hw_sep', assignmentName: '數習 P.10', status: '已繳', remark: '', isMakeup: false, isLeave: false }
            ]
        };
        const archOct = {
            id: 'arc_1020',
            timestamp: new Date('2026-10-20T16:00:00').getTime(),
            dateLabel: '2026/10/20',
            assignments: [{ id: 'hw_oct', name: '國習 L5', subjectName: '國語' }],
            records: [
                { studentId: 's1', assignmentId: 'hw_oct', assignmentName: '國習 L5', status: '未繳', remark: '', isMakeup: false, isLeave: false },
                { studentId: 's2', assignmentId: 'hw_oct', assignmentName: '國習 L5', status: '未繳', remark: '請假', isMakeup: false, isLeave: true },
                { studentId: 's3', assignmentId: 'hw_oct', assignmentName: '國習 L5', status: '已繳', remark: '', isMakeup: false, isLeave: false }
            ]
        };

        assert.strictEqual(resolveAssignmentISODate({ dateLabel: '9/25', timestamp: archSep.timestamp }, 'hw_sep'), '2026-09-25');

        const stats = computeMakeupAndLeaveStats({
            settings: {
                className: '608',
                students,
                subjects: [{ id: 'sub_ch', name: '國語' }, { id: 'sub_ma', name: '數學' }],
                assignments: []
            },
            records: [],
            gradingRecords: [],
            archiveDocsList: [archOct, archSep],
            startDate: '2026-09-01',
            endDate: '2026-11-05',
            includeContactBook: true,
            includeActive: false,
            includeCleanStudents: false
        });

        assert.strictEqual(stats.assignmentCount, 2);
        assert.strictEqual(stats.students.length, 2, '全勤無補繳請假者預設不顯示');
        const st1 = stats.students.find(x => x.studentId === 's1');
        const st2 = stats.students.find(x => x.studentId === 's2');
        assert.strictEqual(st1.regularMakeup.length, 1, '王小明一般補繳 1 件');
        assert.strictEqual(st1.regularMissing.length, 1, '王小明一般未繳 1 件');
        assert.strictEqual(st1.totalLeaveCount, 0);
        assert.deepStrictEqual(st1.subjectGroups.map(g => g.subjectName), ['國語', '數學'], '明細應依科目設定順序排列');
        assert.strictEqual(st1.subjectGroups[0].regularMissing.length, 1, '國語分組應統計未繳 1');
        assert.strictEqual(st1.subjectGroups[1].regularMakeup.length, 1, '數學分組應統計已補 1');

        assert.strictEqual(st2.regularMakeup.length, 0, '李小華因請假補繳不計入一般補繳');
        assert.strictEqual(st2.regularMissing.length, 0, '李小華因請假未繳不計入一般未繳');
        assert.strictEqual(st2.leaveMakeup.length, 1, '李小華因請假已補繳另外算 1 件');
        assert.strictEqual(st2.leaveMissing.length, 1, '李小華因請假未繳另外算 1 件');

        const report = formatMakeupAndLeaveReport(stats, { className: '608', startDate: '2026-09-01', endDate: '2026-11-05' });
        assert.strictEqual(report.includes('期中／期末 作業補繳與未繳統計'), true);
        assert.strictEqual(report.includes('已補 1｜未繳 1'), true);
        assert.strictEqual(report.includes('請假 2（已補 1／未繳 1）'), true);
        assert.strictEqual(report.includes('【國語】未繳 1'), true);
        assert.strictEqual(report.includes('【數學】已補 1'), true);

        // 測試：若科目全為紫色，排到最後，優先顯示含藍、紅的科目
        const archMixed = {
            id: 'arc_mixed',
            timestamp: new Date('2026-10-25T16:00:00').getTime(),
            dateLabel: '10/25',
            assignments: [
                { id: 'asg_ch_leave', name: '國習 L6', subjectName: '國語' },
                { id: 'asg_soc_missing', name: '社習 U3', subjectName: '社會' }
            ],
            records: [
                { studentId: 's4', assignmentId: 'asg_ch_leave', assignmentName: '國習 L6', status: '未繳', remark: '請假', isLeave: true },
                { studentId: 's4', assignmentId: 'asg_soc_missing', assignmentName: '社習 U3', status: '未繳', remark: '', isLeave: false }
            ]
        };
        const statsMixed = computeMakeupAndLeaveStats({
            settings: { className: '608', students: [{ id: 's4', name: '陳同學', seat: '4' }], assignments: [] },
            archiveDocsList: [archMixed]
        });
        const st4 = statsMixed.students[0];
        assert.deepStrictEqual(st4.subjectGroups.map(g => g.subjectName), ['社會', '國語'], '含未繳(紅)的社會應優先於全為請假(紫)的國語');
    }
}


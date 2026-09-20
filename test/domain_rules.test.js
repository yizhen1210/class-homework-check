/**
 * 領域邏輯單元測試套件
 */
import {
    sortBySeat,
    isPulledOut,
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
    isGradingMissingExempt
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
}


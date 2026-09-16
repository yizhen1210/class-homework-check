/**
 * 班級作業登記系統 - Firebase 服務層 (Firebase Service Layer)
 * 統一封裝驗證、資料庫監聽、安全批次寫入與錯誤處理。
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    signOut,
    signInWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore,
    collection,
    doc,
    query,
    orderBy,
    where,
    onSnapshot,
    addDoc,
    deleteDoc,
    setDoc,
    getDocs,
    writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

import { recordDocId } from '../domain/rules.js';
import { logger } from '../utils/logger.js';
import { showAlert } from '../ui/modals.js';

export const firebaseConfig = {
    apiKey: "AIzaSyACHWb3UBP-RGFw4mX9suOGL0M-2Zz-eAo",
    authDomain: "class-homework-check.firebaseapp.com",
    projectId: "class-homework-check",
    storageBucket: "class-homework-check.firebasestorage.app",
    messagingSenderId: "426793456547",
    appId: "1:426793456547:web:e7b87de8e1b05ef4d48016"
};

export const COLL_PATH = "records";
export const ORDER_FIELD = "timestamp";
export const ORDER_DIR = "desc";
export const SETTINGS_PATH = ["config", "settings"];

export const LOGIN_MODE = 'A';
export const SHARED_EMAIL = "annychen1210@gmail.com";
export const ALLOWED_EMAILS = ["one@gmail.com", "two@gmail.com"];

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const coll = collection(db, COLL_PATH);
export const settingsRef = doc(db, ...SETTINGS_PATH);
export const archivesColl = collection(db, "archives");
export const gradingColl = collection(db, "gradingRecords");
export const pointLogsColl = collection(db, "pointLogs");

export function isAuthorized(user) {
    if (!user) return false;
    if (LOGIN_MODE === 'A') return user.email === SHARED_EMAIL;
    if (LOGIN_MODE === 'B') return user.email === ALLOWED_EMAILS[0];
    if (LOGIN_MODE === 'C') return ALLOWED_EMAILS.slice(0, 2).includes(user.email);
    return false;
}

export async function loginWithEmail(password) {
    try {
        await signInWithEmailAndPassword(auth, SHARED_EMAIL, password);
        logger.info('AUTH_LOGIN_SUCCESS', { email: SHARED_EMAIL });
        return true;
    } catch (e) {
        logger.warn('AUTH_LOGIN_FAILED', e);
        throw e;
    }
}

export async function loginWithGoogle() {
    try {
        const result = await signInWithPopup(auth, new GoogleAuthProvider());
        logger.info('AUTH_GOOGLE_LOGIN_SUCCESS', { email: result.user?.email });
        return result.user;
    } catch (e) {
        logger.warn('AUTH_GOOGLE_LOGIN_FAILED', e);
        throw e;
    }
}

export async function logout() {
    await signOut(auth);
    logger.info('AUTH_LOGOUT');
}

/**
 * 批次寫入安全封裝 (避免超過 Firestore 單次 500 筆上限)
 */
async function commitInChunks(docRefs, deleteOperation = true) {
    const CHUNK_SIZE = 450;
    for (let i = 0; i < docRefs.length; i += CHUNK_SIZE) {
        const batch = writeBatch(db);
        const chunk = docRefs.slice(i, i + CHUNK_SIZE);
        chunk.forEach(ref => {
            if (deleteOperation) batch.delete(ref);
        });
        await batch.commit();
    }
}

export async function clearAll(excludeAssignmentIds = []) {
    try {
        const exclude = new Set(excludeAssignmentIds || []);
        const snap = await getDocs(coll);
        const refsToDelete = snap.docs
            .filter(d => !exclude.has(d.data().assignmentId))
            .map(d => doc(db, COLL_PATH, d.id));
        await commitInChunks(refsToDelete, true);
        logger.info('CLEAR_ALL_RECORDS', { count: refsToDelete.length });
    } catch (e) {
        logger.error('CLEAR_ALL_FAILED', e);
        showAlert('清空作業紀錄失敗，請檢查網路');
    }
}

export async function clearRecordsForAssignment(assignmentId) {
    try {
        const snap = await getDocs(query(coll, where('assignmentId', '==', assignmentId)));
        const refs = snap.docs.map(d => doc(db, COLL_PATH, d.id));
        await commitInChunks(refs, true);
    } catch (e) {
        logger.error('CLEAR_ASSIGNMENT_RECORDS_FAILED', e);
    }
}

export async function clearGradingForAssignment(assignmentId) {
    try {
        const snap = await getDocs(query(gradingColl, where('assignmentId', '==', assignmentId)));
        const refs = snap.docs.map(d => doc(gradingColl, d.id));
        await commitInChunks(refs, true);
    } catch (e) {
        logger.error('CLEAR_ASSIGNMENT_GRADING_FAILED', e);
    }
}

export function saveSettings(obj, isAdmin = false) {
    if (!isAdmin) {
        logger.warn('SAVE_SETTINGS_DENIED_NOT_ADMIN');
        return Promise.resolve();
    }
    return setDoc(settingsRef, obj, { merge: true }).catch(e => {
        logger.error('SAVE_SETTINGS_FAILED', e);
        showAlert('儲存設定失敗，請確認網路連線');
    });
}

export function submitGroupRecords(items) {
    const batch = writeBatch(db);
    const ts = Date.now();
    items.forEach(it => {
        const ref = doc(coll, recordDocId(it.studentId, it.assignmentId));
        batch.set(ref, { ...it, [ORDER_FIELD]: ts }, { merge: true });
    });
    return batch.commit().catch(e => {
        logger.error('SUBMIT_GROUP_RECORDS_FAILED', e);
        showAlert('送出失敗，請檢查網路後重試');
    });
}

export function adminSetStatus(item) {
    const ref = doc(coll, recordDocId(item.studentId, item.assignmentId));
    return setDoc(ref, { ...item, [ORDER_FIELD]: Date.now() }, { merge: true }).catch(e => {
        logger.error('ADMIN_SET_STATUS_FAILED', e);
        showAlert('操作失敗，請檢查網路後重試');
    });
}

export function adminSetGrading(item) {
    const ref = doc(gradingColl, recordDocId(item.studentId, item.assignmentId));
    return setDoc(ref, { ...item, updatedAt: Date.now() }, { merge: true }).catch(e => {
        logger.error('ADMIN_SET_GRADING_FAILED', e);
        showAlert('操作失敗，請檢查網路後重試');
    });
}


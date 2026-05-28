export const Sanitizer = {
    // Safely converts null/undefined to empty string
    asString: (val: any) => (val === null || val === undefined) ? '' : String(val),
    
    // Safely converts invalid numbers to 0 (MISSING IN YOUR CODE)
    asNumber: (val: any) => {
        if (val === null || val === undefined) return 0;
        const num = Number(val);
        return isNaN(num) ? 0 : num;
    },

    // Removes duplicates and empty values from a list
    cleanList: (list: any[]) => {
        if (!Array.isArray(list)) return [];
        return Array.from(new Set(list))
            .filter(item => item !== null && item !== undefined && item !== '')
            .sort();
    }
};








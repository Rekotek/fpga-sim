// Урок 7, домашнее задание: кодовый замок на кнопках S1 и S2.
// Код: S1, S2, S2, S1. Каждое верное нажатие зажигает ещё один светодиод,
// неверное — сброс к началу. После четвёртого верного горят все шесть: «открыто».
// Любое нажатие в состоянии «открыто» снова закрывает замок.
module top #(
    parameter integer CLK_HZ = 27_000_000   // частота clk; тестбенч ставит меньше
) (
    input  wire       clk,      // 27 МГц, вывод 4
    input  wire       btn_s1,   // кнопка S1, вывод 88
    input  wire       btn_s2,   // кнопка S2, вывод 87
    output wire [5:0] led       // LED0..LED5, выводы 15..20, горят при 0
);
    // ---------- Входы: всё из урока 6, теперь для обеих кнопок ----------
    // Полярность кнопки: «нажата = 1» — проверено на плате.
    localparam PRESSED = 1'b1;
    wire s1_in = (btn_s1 == PRESSED);
    wire s2_in = (btn_s2 == PRESSED);

    // Синхронизаторы: по два триггера на кнопку.
    reg s1_meta = 1'b0, s1_sync = 1'b0;
    reg s2_meta = 1'b0, s2_sync = 1'b0;

    always @(posedge clk) begin
        s1_meta <= s1_in;
        s1_sync <= s1_meta;
        s2_meta <= s2_in;
        s2_sync <= s2_meta;
    end

    // Делитель антидребезга: тик раз в 10 мс (100 раз в секунду).
    localparam integer DB_LAST = CLK_HZ / 100 - 1;   // 269 999 при 27 МГц
                                                     // 269 999 < 2^19 = 524 288 → 19 бит
    reg  [18:0] db_div = 19'd0;
    wire        db_tick = (db_div == DB_LAST);

    always @(posedge clk) begin
        if (db_tick) db_div <= 19'd0;
        else         db_div <= db_div + 1'b1;
    end

    // Антидребезг обеих кнопок по одному общему тику.
    reg s1_db = 1'b0, s2_db = 1'b0;

    always @(posedge clk)
        if (db_tick) begin
            s1_db <= s1_sync;
            s2_db <= s2_sync;
        end

    // Детекторы фронта: «тик от кнопки».
    reg  s1_prev = 1'b0, s2_prev = 1'b0;
    wire s1_press = s1_db & ~s1_prev;
    wire s2_press = s2_db & ~s2_prev;

    always @(posedge clk) begin
        s1_prev <= s1_db;
        s2_prev <= s2_db;
    end

    // ---------- Автомат замка ----------
    localparam [2:0] S_0    = 3'd0,   // ничего не введено
                     S_1    = 3'd1,   // введено: S1
                     S_12   = 3'd2,   // введено: S1 S2
                     S_122  = 3'd3,   // введено: S1 S2 S2
                     S_OPEN = 3'd4;   // открыто

    reg [2:0] state = S_0;      // регистр состояния
    reg [2:0] next;             // следующее состояние

    // Логика переходов. Нет нажатия — остаёмся (строчка по умолчанию).
    always @(*) begin
        next = state;
        case (state)
            S_0: begin
                if (s1_press)      next = S_1;      // верно
                else if (s2_press) next = S_0;      // неверно — с начала
            end
            S_1: begin
                if (s2_press)      next = S_12;     // верно
                else if (s1_press) next = S_0;      // неверно
            end
            S_12: begin
                if (s2_press)      next = S_122;    // верно
                else if (s1_press) next = S_0;      // неверно
            end
            S_122: begin
                if (s1_press)      next = S_OPEN;   // верно — открыто!
                else if (s2_press) next = S_0;      // неверно
            end
            S_OPEN: begin
                if (s1_press || s2_press) next = S_0;   // любое нажатие закрывает
            end
            default: next = S_0;                    // 5, 6, 7 — не наши состояния
        endcase
        if (s1_press && s2_press) next = S_0;       // обе сразу — ошибка (последнее выигрывает)
    end

    // Регистр состояния: только «state <= next».
    always @(posedge clk)
        state <= next;

    // Выходы: сколько светодиодов горит — зависит только от состояния.
    reg [5:0] on;               // 1 = горит

    always @(*) begin
        case (state)
            S_0:     on = 6'b000000;
            S_1:     on = 6'b000001;
            S_12:    on = 6'b000011;
            S_122:   on = 6'b000111;
            S_OPEN:  on = 6'b111111;
            default: on = 6'b000000;
        endcase
    end

    assign led = ~on;   // светодиоды горят по нулю
endmodule

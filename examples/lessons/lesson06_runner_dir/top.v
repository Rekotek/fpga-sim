// Урок 6, задание «Разворот»: бегущий огонь из урока 5 с двумя кнопками.
// S1 — развернуть огонёк (по нажатию), S2 — сброс: огонёк на LED0, идёт к LED5.
module top #(
    parameter integer CLK_HZ = 27_000_000   // частота clk; тестбенч ставит меньше
) (
    input  wire       clk,      // 27 МГц, вывод 4
    input  wire       btn_s1,   // кнопка S1, вывод 88: разворот
    input  wire       btn_s2,   // кнопка S2, вывод 87: сброс
    output wire [5:0] led       // LED0..LED5, выводы 15..20, горят при 0
);
    // Полярность кнопки: «нажата = 1» (проверено на плате, PULL_MODE=DOWN в top.cst).
    // Если на другой плате окажется «нажата = 0», поменять здесь 1'b1 на 1'b0 — и всё.
    localparam PRESSED = 1'b1;
    wire s1_in = (btn_s1 == PRESSED);        // 1 = нажата, при любой полярности
    wire s2_in = (btn_s2 == PRESSED);

    // Синхронизаторы: по два триггера на каждую кнопку.
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
    wire        db_tick = (db_div == DB_LAST);       // 1 на один такт раз в 10 мс

    always @(posedge clk) begin
        if (db_tick) db_div <= 19'd0;
        else         db_div <= db_div + 1'b1;
    end

    // Антидребезг: смотрим на кнопку только по тику, раз в 10 мс.
    reg s1_db = 1'b0;

    always @(posedge clk)
        if (db_tick) s1_db <= s1_sync;

    // Детектор фронта — теперь на чистом сигнале s1_db.
    reg  s1_prev = 1'b0;
    wire s1_press = s1_db & ~s1_prev;        // 1 ровно на один такт после нажатия

    always @(posedge clk)
        s1_prev <= s1_db;

    // Делитель бегущего огня: 8 шагов в секунду (как в уроке 5).
    localparam integer LAST = CLK_HZ / 8 - 1;        // 3 374 999 → 22 бита
    reg  [21:0] div = 22'd0;
    wire        tick = (div == LAST);

    always @(posedge clk) begin
        if (tick) div <= 22'd0;
        else      div <= div + 1'b1;
    end

    // Направление: 0 — к LED5, 1 — к LED0. Каждое нажатие S1 переворачивает.
    reg dir = 1'b0;

    always @(posedge clk) begin
        if (s2_sync)       dir <= 1'b0;
        else if (s1_press) dir <= ~dir;
    end

    // Кольцо из 6 триггеров, крутится в сторону dir.
    reg [5:0] sr = 6'b000001;

    always @(posedge clk) begin
        if (s2_sync)
            sr <= 6'b000001;
        else if (tick) begin
            if (dir == 1'b0) sr <= {sr[4:0], sr[5]};   // к LED5
            else             sr <= {sr[0], sr[5:1]};   // к LED0
        end
    end

    assign led = ~sr;   // светодиоды горят по нулю
endmodule

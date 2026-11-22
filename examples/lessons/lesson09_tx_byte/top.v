// Урок 9, практика 1: по нажатию S1 плата посылает на Mac букву «H».
// Кнопка — цепочка из урока 6 (синхронизатор, антидребезг, фронт),
// передатчик — отдельный модуль uart_tx (файл uart_tx.v).
// LED0..LED5 показывают, сколько букв отправлено (двоичный счётчик).
module top #(
    parameter integer CLK_HZ = 27_000_000,  // частота clk; тестбенч ставит меньше
    parameter integer BAUD   = 115_200      // скорость UART; тестбенч ставит меньше
) (
    input  wire       clk,      // 27 МГц, вывод 4
    input  wire       btn_s1,   // кнопка S1, вывод 88: отправить букву
    output wire       uart_tx,  // UART: от ПЛИС к BL616 и в Mac, вывод 69
    output wire [5:0] led       // LED0..LED5, выводы 15..20, горят при 0
);
    // ---------- Кнопка S1: как в уроках 6–8 ----------
    // Полярность кнопки: «нажата = 1» — проверено на плате.
    localparam PRESSED = 1'b1;
    wire s1_in = (btn_s1 == PRESSED);

    reg s1_meta = 1'b0, s1_sync = 1'b0;     // синхронизатор

    always @(posedge clk) begin
        s1_meta <= s1_in;
        s1_sync <= s1_meta;
    end

    localparam integer DB_LAST = CLK_HZ / 100 - 1;   // тик раз в 10 мс: 269 999 → 19 бит
    reg  [18:0] db_div = 19'd0;
    wire        db_tick = (db_div == DB_LAST);

    always @(posedge clk) begin
        if (db_tick) db_div <= 19'd0;
        else         db_div <= db_div + 1'b1;
    end

    reg s1_db = 1'b0, s1_prev = 1'b0;       // антидребезг и фронт

    always @(posedge clk) begin
        if (db_tick) s1_db <= s1_sync;
        s1_prev <= s1_db;
    end

    wire s1_press = s1_db & ~s1_prev;       // один такт на нажатие

    // ---------- Передатчик UART: экземпляр модуля ----------
    wire busy;

    uart_tx #(.CLK_HZ(CLK_HZ), .BAUD(BAUD)) tx0 (
        .clk   (clk),
        .start (s1_press & ~busy),          // не мешать кадру, который ещё идёт
        .data  ("H"),                       // 8'h48 — код буквы H
        .tx    (uart_tx),
        .busy  (busy)
    );

    // ---------- Счётчик отправленных букв на светодиодах ----------
    reg [5:0] sent = 6'd0;

    always @(posedge clk)
        if (s1_press & ~busy) sent <= sent + 1'b1;

    assign led = ~sent;
endmodule

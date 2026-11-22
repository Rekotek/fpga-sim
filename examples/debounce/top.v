// Ожидаемое поведение: кнопка S1 дребезжит 5 мс после каждого нажатия и отпускания
// (настройка bounceMs детали s1 в fpgasim.json).
// led[2:0] — счётчик нажатий с подавлением дребезга: ровно +1 за нажатие.
// led[5:3] — счётчик без подавления: считает каждый фронт кнопки, за одно нажатие
// с отпусканием увеличивается не меньше чем на 3. Светодиоды горят при нуле.
// Проверочные числа: три нажатия (0,1; 0,5; 0,9 с) с отпусканием через 0,2 с — вывод 15
// переключается 3 раза, вывод 16 — 1 раз, вывод 18 — не меньше 9 раз.
module top (
    input  wire       clk,
    input  wire       btn,
    output wire [5:0] led
);
    // Кнопка считается установившейся, когда держит уровень 10 мс: дольше дребезга.
    localparam [18:0] STABLE_TICKS = 19'd270_000;

    // Синхронизатор: кнопка не связана с тактом.
    reg [1:0] sync = 2'b00;
    always @(posedge clk) sync <= {sync[0], btn};
    wire pressed = sync[1];

    // Без подавления: +1 на каждый передний фронт, включая фронты дребезга.
    reg       pressed_d = 1'b0;
    reg [2:0] cnt_raw   = 3'd0;
    always @(posedge clk) begin
        pressed_d <= pressed;
        if (pressed && !pressed_d) cnt_raw <= cnt_raw + 3'd1;
    end

    // С подавлением: новый уровень принимается, когда продержался STABLE_TICKS тактов.
    reg        stable    = 1'b0;
    reg [18:0] hold      = 19'd0;
    reg [2:0]  cnt_clean = 3'd0;
    always @(posedge clk) begin
        if (pressed == stable) begin
            hold <= 19'd0;
        end else if (hold == STABLE_TICKS - 19'd1) begin
            hold   <= 19'd0;
            stable <= pressed;
            if (pressed) cnt_clean <= cnt_clean + 3'd1;
        end else begin
            hold <= hold + 19'd1;
        end
    end

    assign led = ~{cnt_raw, cnt_clean};
endmodule
